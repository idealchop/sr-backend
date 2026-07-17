import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  InventoryService,
  type InventoryItem,
} from "../inventory/inventory-service";
import { CustomerLastFulfilledService } from "../customers/customer-last-fulfilled-service";
import { CustomerHealthScoreService } from "../customers/customer-health-score-service";
import { AnalyticsMaterializerService } from "../analytics/analytics-materializer-service";
import { notifyTransactionUpdated } from "../notifications/station-activity-notification-service";
import {
  applyOwnedShapePossessionTarget,
  dueDiligenceOwnedPossessionTarget,
  dueDiligenceRequiresWrPossessionSync,
  isRiderContainerDueDiligence,
} from "./delivery-rider-due-diligence";
import { syncCustomerAssetPossession } from "./sync-customer-asset-possession";
import { logCollectionContainerAudit } from "./collection-item-utils";
import type { Transaction } from "./transaction-types";
import { customerHasUnpaidReceivable } from "./customer-unpaid-receivable";

/**
 * Post-commit side effects after `updateTransaction` Firestore write succeeds:
 * low-stock checks, delivery sync, hasBalance, possession, health/analytics, notify.
 */
export async function runUpdateTransactionPostCommit(params: {
  businessId: string;
  transactionId: string;
  current: Transaction;
  updates: Partial<Transaction>;
  itemsToCheck: Set<string>;
  becomingDispatched: boolean;
  changedFields: string[];
  userId?: string;
  userName?: string;
  shouldSyncWrContainerPossession: (
    businessId: string,
    customerId: string,
  ) => Promise<boolean>;
}): Promise<void> {
  const {
    businessId,
    transactionId,
    current,
    updates,
    itemsToCheck,
    becomingDispatched,
    changedFields,
    userId,
    userName,
  } = params;

  for (const invId of itemsToCheck) {
    try {
      const itemRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .doc(invId);
      const itemSnap = await itemRef.get();
      if (itemSnap.exists) {
        const item = {
          ...itemSnap.data(),
          id: itemSnap.id,
        } as InventoryItem;
        await InventoryService.checkLowStockAndNotify(businessId, item);
      }
    } catch (err) {
      logger.error(`Failed to check low stock for item ${invId}`, err);
    }
  }

  if (
    ["completed", "delivered", "collected"].includes(
      updates.deliveryStatus || "",
    )
  ) {
    const deliverySnapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("deliveries")
      .where("transactionId", "==", transactionId)
      .limit(1)
      .get();

    if (!deliverySnapshot.empty) {
      const deliveryDoc = deliverySnapshot.docs[0];
      await deliveryDoc.ref.update({
        status:
          updates.deliveryStatus === "collected" ? "collected" : "delivered",
        signatureUrl: updates.signatureUrl || null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  const customerId = updates.customerId || current.customerId;
  if (customerId) {
    const hasBalance = await customerHasUnpaidReceivable(
      businessId,
      customerId,
    );

    await db
      .collection("businesses")
      .doc(businessId)
      .collection("customers")
      .doc(customerId)
      .update({
        hasBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  const possessionSyncType = current.type;
  const itemsChanged =
    updates.items !== undefined || updates.collectionItems !== undefined;
  const riderDueDiligence = isRiderContainerDueDiligence(
    updates.riderContainerDueDiligence,
  ) ?
    updates.riderContainerDueDiligence :
    isRiderContainerDueDiligence(
      (current as Transaction).riderContainerDueDiligence,
    ) ?
      (current as Transaction).riderContainerDueDiligence :
      undefined;
  const shouldSyncPossession =
    customerId &&
    (possessionSyncType === "delivery" ||
      possessionSyncType === "collection") &&
    (itemsChanged || becomingDispatched || riderDueDiligence);
  if (shouldSyncPossession && customerId) {
    const mergedCollection =
      updates.collectionItems ?? current.collectionItems ?? [];
    const syncWrShellPossession =
      dueDiligenceRequiresWrPossessionSync(riderDueDiligence) ||
      (await params.shouldSyncWrContainerPossession(businessId, customerId));
    if (syncWrShellPossession) {
      await syncCustomerAssetPossession(
        businessId,
        customerId,
        updates.items ?? current.items ?? [],
        mergedCollection,
        transactionId,
        userId,
        false,
        userName,
      );
      if (updates.collectionItems !== undefined && mergedCollection.length > 0) {
        await logCollectionContainerAudit(
          businessId,
          transactionId,
          customerId,
          mergedCollection,
          userId,
          "COLLECTION_CONTAINER_UPDATED",
          current.referenceId,
          userName,
        );
      }
    }
    const ownedTarget = dueDiligenceOwnedPossessionTarget(riderDueDiligence);
    if (ownedTarget != null) {
      await applyOwnedShapePossessionTarget(
        businessId,
        customerId,
        ownedTarget,
      );
    }
  }

  const docRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(transactionId);
  const refreshed = await docRef.get();
  if (refreshed.exists) {
    const merged = {
      ...current,
      ...updates,
      ...refreshed.data(),
    } as Transaction;
    await CustomerLastFulfilledService.touchFromTransaction(businessId, merged);
    CustomerHealthScoreService.scheduleRecompute(businessId, merged.customerId);
    AnalyticsMaterializerService.scheduleMaterialize(businessId);
    void notifyTransactionUpdated(
      businessId,
      transactionId,
      current,
      merged,
      userId,
      changedFields,
    ).catch((err) => {
      logger.warn("notifyTransactionUpdated failed", {
        businessId,
        transactionId,
        err,
      });
    });
  }
}
