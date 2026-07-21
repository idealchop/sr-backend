import {
  assertNoSyncConflict,
} from "./sync-conflict";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import {
  InventoryService,
  type StockDeltaApplyResult,
} from "../inventory/inventory-service";
import { syncPortalTrackLiveOnDeliveryStatus } from "../portal/portal-track-live-service";
import {
  isIdempotentPaymentPatch,
} from "./client-mutation-id";
import { applyUpdatePaymentFields } from "./update-transaction-payment-prep";
import {
  detectTransactionChangedFields,
  extractPaymentCorrectionReason,
} from "./detect-transaction-changed-fields";
import { buildUpdateStockDeltaPlan } from "./build-update-stock-deltas";
import { runUpdateTransactionPostCommit } from "./update-transaction-post-commit";
import { normalizeCollectionItems } from "./collection-item-utils";
import { shouldSyncWrContainerPossession } from "./sync-customer-asset-possession";
import { reverseTransactionEffects } from "./reverse-transaction-effects";
import {
  getSoleActiveRiderId,
  syncTransactionRiderRef,
} from "./transaction-rider-helpers";
import { logTransactionStockAuditRows } from "./log-transaction-stock-audit";
import type { Transaction } from "./transaction-types";

/**
 * Updates a transaction (payments, status, inventory side-effects).
 */
export async function updateTransaction(
  businessId: string,
  transactionId: string,
  updates: Partial<Transaction>,
  userId?: string,
  userName?: string,
): Promise<boolean> {
  const actor = buildAuditActorFields(userId, userName);
  try {
    const docRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .doc(transactionId);

    // Remove id from updates if it exists to avoid trying to update the document ID field
    if (updates.id) {
      delete (updates as { id?: string }).id;
    }

    // Enforce immutability for walkin_refill and direct_sale
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`Transaction ${transactionId} not found`);
    }
    const current = doc.data() as Transaction;

    assertNoSyncConflict(
      current,
      updates as Partial<Transaction> & {
        baseUpdatedAt?: unknown;
        forceApply?: boolean;
      },
      current,
    );
    delete (updates as Partial<Transaction> & { baseUpdatedAt?: unknown })
      .baseUpdatedAt;
    delete (updates as Partial<Transaction> & { forceApply?: boolean })
      .forceApply;

    if (
      updates.payments &&
      isIdempotentPaymentPatch(current, {
        payments: updates.payments,
        amountPaid: updates.amountPaid ?? current.amountPaid ?? 0,
      })
    ) {
      return false;
    }

    const effectiveType = (updates.type ?? current.type) as
      | string
      | undefined;
    if (
      (effectiveType === "delivery" || effectiveType === "collection") &&
      !Object.prototype.hasOwnProperty.call(updates, "riderId") &&
      !current.riderId
    ) {
      const sole = await getSoleActiveRiderId(businessId);
      if (sole) {
        (updates as Partial<Transaction>).riderId = sole;
      }
    }

    await syncTransactionRiderRef(businessId, updates);

    if (Object.prototype.hasOwnProperty.call(updates, "expenseStaffId")) {
      const rawStaffId = (updates as { expenseStaffId?: unknown }).expenseStaffId;
      if (rawStaffId === null || rawStaffId === undefined || rawStaffId === "") {
        (updates as Record<string, unknown>).expenseStaffId = FieldValue.delete();
        (updates as Record<string, unknown>).expenseStaffName = FieldValue.delete();
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "expenseStaffName")) {
      const rawStaffName = (updates as { expenseStaffName?: unknown }).expenseStaffName;
      if (rawStaffName === null || rawStaffName === undefined || rawStaffName === "") {
        (updates as Record<string, unknown>).expenseStaffName = FieldValue.delete();
      }
    }

    // Allow payment updates even for completed transactions
    const isCoreChange =
      updates.items !== undefined ||
      updates.totalAmount !== undefined ||
      updates.type !== undefined;

    if (
      (current.type === "walkin" || current.type === "direct_sale") &&
      current.deliveryStatus === "completed" &&
      isCoreChange
    ) {
      throw new Error(
        `Transactions of type ${current.type} are permanent. ` +
          "Items and total amount cannot be edited once completed.",
      );
    }

    applyUpdatePaymentFields(current, updates);

    const changedFields = detectTransactionChangedFields(current, updates);

    if (updates.collectionItems !== undefined) {
      updates.collectionItems = normalizeCollectionItems(
        updates.collectionItems,
      );
    }

    // --- REVERSAL LOGIC FOR FAILED/CANCELLED ---
    if (
      (updates.deliveryStatus === "failed" ||
        updates.deliveryStatus === "cancelled") &&
      current.deliveryStatus !== "failed" &&
      current.deliveryStatus !== "cancelled"
    ) {
      // 1. Revert inventory and possession
      await reverseTransactionEffects(
        businessId,
        transactionId,
        current,
        userId,
      );

      // 2. Zero out financials and set status to N/A
      updates.totalAmount = 0;
      updates.amountPaid = 0;
      updates.balanceDue = 0;
      updates.paymentStatus = "N/A";

      // Ensure payments array is also emptied if we are zeroing out paid amount
      updates.payments = [];
    }

    // --- PREPARE UPDATES ---
    const nextDeliveryStatus =
      updates.deliveryStatus !== undefined ?
        updates.deliveryStatus :
        current.deliveryStatus;
    const nextCollectionItems =
      updates.collectionItems !== undefined ?
        updates.collectionItems :
        current.collectionItems || [];

    // --- EXECUTE ATOMICALLY ---
    let stockApplyResults: StockDeltaApplyResult[] = [];
    let becomingDispatched = false;
    let itemsToCheck = new Set<string>();
    await db.runTransaction(async (t) => {
      const skippingInventoryMutation =
        updates.deliveryStatus === "failed" ||
        updates.deliveryStatus === "cancelled";

      const finalUpdates: Record<string, unknown> = {
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      };

      const stockPlan = buildUpdateStockDeltaPlan({
        current,
        updates,
        nextDeliveryStatus,
        nextCollectionItems,
        skippingInventoryMutation,
      });
      becomingDispatched = stockPlan.becomingDispatched;
      itemsToCheck = stockPlan.itemsToCheck;

      if (stockPlan.stockDeltas.size > 0) {
        stockApplyResults =
          await InventoryService.applyStockDeltasInTransaction(
            t,
            businessId,
            stockPlan.stockDeltas,
          );
      }

      if (stockPlan.didDispatchSalesInventory) {
        finalUpdates.salesStockApplied = true;
      }

      if (
        nextDeliveryStatus === "in-transit" &&
        current.deliveryStatus !== "in-transit" &&
        !current.arrivedAt &&
        finalUpdates.arrivedAt === undefined
      ) {
        finalUpdates.arrivedAt = FieldValue.serverTimestamp();
      }

      const nextComplete =
        nextDeliveryStatus === "delivered" ||
        nextDeliveryStatus === "collected" ||
        nextDeliveryStatus === "completed";
      const wasComplete =
        current.deliveryStatus === "delivered" ||
        current.deliveryStatus === "collected" ||
        current.deliveryStatus === "completed";
      if (
        nextComplete &&
        !wasComplete &&
        !current.deliveredAt &&
        finalUpdates.deliveredAt === undefined
      ) {
        finalUpdates.deliveredAt = FieldValue.serverTimestamp();
      }

      t.update(docRef, finalUpdates as any);
    });

    await logTransactionStockAuditRows(businessId, stockApplyResults, {
      transactionId,
      referenceId: current.referenceId,
      customerId: current.customerId,
      customerName: current.customerName,
      auditType: "transaction_update",
      transactionType: current.type,
      userId,
      userName,
    });

    // --- AUDIT LOGGING ---
    let hasLoggedSpecific = false;

    if (
      updates.deliveryStatus &&
      updates.deliveryStatus !== current.deliveryStatus
    ) {
      await logAuditEvent(
        "STATUS_CHANGED",
        { businessId, field: "deliveryStatus", ...actor },
        current.deliveryStatus,
        updates.deliveryStatus,
        transactionId,
      );
      hasLoggedSpecific = true;
      void syncPortalTrackLiveOnDeliveryStatus(businessId, {
        referenceId: current.referenceId,
        riderId: String(updates.riderId ?? current.riderId ?? ""),
        deliveryStatus: updates.deliveryStatus,
      }).catch((error) => {
        logger.warn("syncPortalTrackLiveOnDeliveryStatus failed", {
          businessId,
          transactionId,
          error,
        });
      });
    }

    if (
      updates.paymentStatus &&
      updates.paymentStatus !== current.paymentStatus
    ) {
      const paymentReason = extractPaymentCorrectionReason(
        updates.payments || current.payments || [],
      );
      await logAuditEvent(
        "PAYMENT_STATUS_CHANGED",
        {
          businessId,
          field: "paymentStatus",
          ...actor,
          ...(paymentReason ? { reason: paymentReason } : {}),
        },
        current.paymentStatus,
        updates.paymentStatus,
        transactionId,
      );
      hasLoggedSpecific = true;
    }

    // Check for new payments
    if (
      updates.payments &&
      updates.payments.length > (current.payments?.length || 0)
    ) {
      const currentCount = current.payments?.length || 0;
      const newPayments = updates.payments.slice(currentCount);
      for (const pay of newPayments) {
        await logAuditEvent(
          "PAYMENT_RECORDED",
          {
            businessId,
            amount: pay.amount,
            method: pay.method,
            notes: pay.notes,
            ...actor,
          },
          null,
          pay,
          transactionId,
        );
      }
      hasLoggedSpecific = true;
    } else if (
      updates.payments &&
      JSON.stringify(updates.payments) !==
        JSON.stringify(current.payments || [])
    ) {
      const paymentReason = extractPaymentCorrectionReason(updates.payments);
      await logAuditEvent(
        "PAYMENT_CORRECTED",
        {
          businessId,
          ...actor,
          summary: paymentReason ?
            `Reason: ${paymentReason}` :
            "Payment amount or status was corrected.",
          ...(paymentReason ? { reason: paymentReason } : {}),
        },
        current.payments || [],
        updates.payments,
        transactionId,
        ["payments", "amountPaid", "balanceDue", "paymentStatus"].filter(
          (field) =>
            Object.prototype.hasOwnProperty.call(updates, field) ||
            field === "payments",
        ),
      );
      hasLoggedSpecific = true;
    }

    // Check for attachments/signatures
    if (
      updates.signatureUrl &&
      updates.signatureUrl !== current.signatureUrl
    ) {
      await logAuditEvent(
        "SIGNATURE_UPLOADED",
        { businessId, signatureUrl: updates.signatureUrl, ...actor },
        current.signatureUrl,
        updates.signatureUrl,
        transactionId,
      );
      hasLoggedSpecific = true;
    }

    if (
      updates.attachmentUrl &&
      updates.attachmentUrl !== current.attachmentUrl
    ) {
      await logAuditEvent(
        "ATTACHMENT_UPLOADED",
        { businessId, attachmentUrl: updates.attachmentUrl, ...actor },
        current.attachmentUrl,
        updates.attachmentUrl,
        transactionId,
      );
      hasLoggedSpecific = true;
    }

    // --- AFTER TRANSACTION: Side Effects ---

    // 1. Audit Logging
    if (changedFields.length > 0) {
      const paymentLedgerFields = new Set([
        "amountPaid",
        "balanceDue",
        "paymentStatus",
        "payments",
        "paymentMethod",
      ]);
      const nonPaymentChanges = changedFields.filter(
        (field) => !paymentLedgerFields.has(field),
      );
      // Skip a redundant TRANSACTION_UPDATED when payment-only changes
      // already produced PAYMENT_RECORDED / PAYMENT_CORRECTED / PAYMENT_STATUS_CHANGED.
      if (nonPaymentChanges.length > 0 || !hasLoggedSpecific) {
        const newValues: Record<string, unknown> = {};
        for (const field of changedFields) {
          newValues[field] = updates[field as keyof Transaction];
        }

        await logAuditEvent(
          "TRANSACTION_UPDATED",
          { businessId, ...actor },
          null,
          newValues,
          transactionId,
          changedFields,
        );
      }
    } else if (!hasLoggedSpecific && Object.keys(updates).length > 0) {
      await logAuditEvent(
        "TRANSACTION_UPDATED",
        { businessId, ...actor },
        null,
        updates,
        transactionId,
      );
    }

    await runUpdateTransactionPostCommit({
      businessId,
      transactionId,
      current,
      updates,
      itemsToCheck,
      becomingDispatched,
      changedFields,
      userId,
      userName,
      shouldSyncWrContainerPossession,
    });

    return true;
  } catch (error) {
    logger.error(`Error updating transaction ${transactionId}`, error);
    throw error;
  }
}
