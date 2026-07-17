import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import { InventoryService } from "../inventory/inventory-service";
import { CustomerService } from "../customers/customer-service";
import {
  customerUsesWrContainerRotation,
  getBusinessContainerDefaultPolicy,
} from "../customers/container-policy";
import { resolveStockInventoryLineId } from "./transaction-line-inventory";
import {
  describeCollectionLine,
  normalizeCollectionItems,
} from "./collection-item-utils";
import type {
  CollectionItem,
  Transaction,
  TransactionInventoryItem,
} from "./transaction-types";

export async function shouldSyncWrContainerPossession(
  businessId: string,
  customerId: string,
): Promise<boolean> {
  const [customer, businessSnap] = await Promise.all([
    CustomerService.getCustomer(businessId, customerId),
    db.collection("businesses").doc(businessId).get(),
  ]);
  const businessDefault = getBusinessContainerDefaultPolicy(
    businessSnap.data() as Record<string, unknown> | undefined,
  );
  return customerUsesWrContainerRotation(customer, businessDefault);
}

export async function syncCustomerAssetPossession(
  businessId: string,
  customerId: string,
  deliveryItems: TransactionInventoryItem[] = [],
  collectionItems: CollectionItem[] = [],
  transactionId: string,
  userId?: string,
  isReverse = false,
  userName?: string,
): Promise<void> {
  const actor = buildAuditActorFields(userId, userName);
  try {
    const dItems = Array.isArray(deliveryItems) ? deliveryItems : [];
    const cItems = Array.isArray(collectionItems) ? collectionItems : [];

    if (dItems.length === 0 && cItems.length === 0) return;

    const customerRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("customers")
      .doc(customerId);

    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      logger.warn(
        `syncCustomerAssetPossession: customer ${customerId} not found`,
      );
      return;
    }

    const data = customerSnap.data();
    const customerName = data?.name || "Unknown Customer";
    const currentPossession = data?.possession || {};
    const updatedPossession = JSON.parse(JSON.stringify(currentPossession));
    let changed = false;

    const updatedCollectionItems = [...cItems];

    const getOrCreate = (id: string, name: string) => {
      if (!updatedPossession[id]) {
        updatedPossession[id] = {
          itemName: name || "Unknown Item",
          quantity: 0,
        };
      }
      return updatedPossession[id];
    };

    // 1. DELIVERY: add containers to customer possession first
    for (const item of dItems) {
      const invId = resolveStockInventoryLineId(item);
      if (!invId || !item.quantity || item.quantity <= 0) continue;

      const pItem = getOrCreate(invId, item.name || "");
      const prevTotal = pItem.quantity || 0;

      if (isReverse) {
        pItem.quantity = Math.max(0, prevTotal - item.quantity);
      } else {
        pItem.quantity = prevTotal + item.quantity;
      }

      if (pItem.quantity !== prevTotal) {
        changed = true;
        const delta = isReverse ? -item.quantity : item.quantity;
        await InventoryService.createAssignment(businessId, {
          inventoryItemId: invId,
          inventoryItemName: item.name || "Unknown Item",
          customerId,
          customerName,
          quantityAssigned: delta,
          date: FieldValue.serverTimestamp(),
          transactionId,
        });
      }
    }

    // 2. COLLECTION: return OK units reduce possession; replacements adjust possession + stock
    for (let i = 0; i < updatedCollectionItems.length; i++) {
      const item = updatedCollectionItems[i];
      if (!item.inventoryId) continue;

      const pItem = getOrCreate(item.inventoryId, item.name);
      const prevTotal = pItem.quantity || 0;

      const qtyReturned = item.qtyOk || 0;
      const qtyReplaced = item.replacedFromInventory ?
        (item.qtyDamaged || 0) + (item.qtyMissing || 0) :
        0;

      const netPossessionChange = qtyReplaced - qtyReturned;

      if (netPossessionChange !== 0) {
        const delta = isReverse ? -netPossessionChange : netPossessionChange;
        if (isReverse) {
          pItem.quantity = Math.max(0, prevTotal - netPossessionChange);
        } else {
          pItem.quantity = Math.max(0, prevTotal + netPossessionChange);
        }
        if (pItem.quantity !== prevTotal) {
          changed = true;
          await InventoryService.createAssignment(businessId, {
            inventoryItemId: item.inventoryId,
            inventoryItemName: item.name || "Unknown Item",
            customerId,
            customerName,
            quantityAssigned: delta,
            date: FieldValue.serverTimestamp(),
            transactionId,
          });
        }
      }

      if (!isReverse && qtyReplaced > 0) {
        try {
          await InventoryService.adjustStock(
            businessId,
            item.inventoryId,
            -qtyReplaced,
            {
              transactionId,
              customerId,
              customerName,
              reason: "COLLECTION_REPLACEMENT_FROM_STOCK",
              type: "deduction",
              summary: describeCollectionLine(item),
              itemName: item.name,
            },
          );
        } catch (err) {
          logger.error(
            `Replacement stock deduct failed for ${item.inventoryId}`,
            err,
          );
        }
      }

      // --- FIFO DEBT RECOVERY (Only on record, not on reversal) ---
      if (!isReverse && item.qtyOk > 0) {
        let remainingQtyOk = item.qtyOk;
        const recoveredFromTxIds: string[] = [];

        // Query past fulfilled txs with deficits (FIFO). Cap + composite index:
        // customerId + deliveryStatus + createdAt (see firestore.indexes.json).
        const pastTransactionsSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("transactions")
          .where("customerId", "==", customerId)
          .where("deliveryStatus", "in", [
            "delivered",
            "collected",
            "completed",
          ])
          .orderBy("createdAt", "asc")
          .limit(100)
          .get();

        for (const doc of pastTransactionsSnap.docs) {
          if (doc.id === transactionId) continue; // Skip current
          if (remainingQtyOk <= 0) break;

          const txData = doc.data() as Transaction;
          if (!txData.collectionItems) continue;

          let txChanged = false;
          const normalizedItems = normalizeCollectionItems(
            txData.collectionItems,
          );

          for (const pastItem of normalizedItems) {
            if (
              pastItem.inventoryId === item.inventoryId &&
              pastItem.deficitQty > 0
            ) {
              const recoveryAmount = Math.min(
                remainingQtyOk,
                pastItem.deficitQty,
              );
              pastItem.qtyOk += recoveryAmount;
              pastItem.qtyCollected = pastItem.qtyOk; // Keep sync

              // Track the recovery link
              if (!pastItem.recoveryLinks) pastItem.recoveryLinks = [];
              pastItem.recoveryLinks.push({
                txId: transactionId,
                amount: recoveryAmount,
              });

              pastItem.deficitQty -= recoveryAmount;

              // Re-normalize this single item to update status
              const updatedPastItem =
                normalizeCollectionItems([pastItem])[0];
              Object.assign(pastItem, updatedPastItem);

              remainingQtyOk -= recoveryAmount;
              txChanged = true;
              if (!recoveredFromTxIds.includes(doc.id)) {
                recoveredFromTxIds.push(doc.id);
              }

              const pastRef =
                (doc.data() as Transaction).referenceId || doc.id;
              await logAuditEvent(
                "COLLECTION_DEFICIT_RECOVERED",
                {
                  businessId,
                  customerId,
                  ...actor,
                  itemName: item.name,
                  inventoryId: item.inventoryId,
                  recoveredAmount: recoveryAmount,
                  recoveredFromTransactionId: doc.id,
                  summary:
                    `${recoveryAmount}× ${item.name} applied to prior owed qty ` +
                    `(from ${pastRef})`,
                },
                null,
                { deficitQty: pastItem.deficitQty },
                transactionId,
              );

              if (remainingQtyOk <= 0) break;
            }
          }

          if (txChanged) {
            await doc.ref.update({
              collectionItems: normalizedItems,
              updatedAt: FieldValue.serverTimestamp(),
            });
            logger.info(
              `FIFO Recovery: Resolved deficit in TX ${doc.id} ` +
                `for item ${item.inventoryId}`,
            );
          }
        }

        if (recoveredFromTxIds.length > 0) {
          item.recoveredFromTxIds = recoveredFromTxIds;
        }
      }
    }

    // Save Customer Possession
    if (changed) {
      await customerRef.update({
        possession: updatedPossession,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await logAuditEvent(
        "POSSESSION_UPDATED",
        { businessId, customerId, ...actor },
        currentPossession,
        updatedPossession,
        transactionId,
      );
    }

    // Update current transaction with recoveredFromTxIds if any
    const hasRecoveredLinks = updatedCollectionItems.some(
      (i) => i.recoveredFromTxIds && i.recoveredFromTxIds.length > 0,
    );
    if (hasRecoveredLinks) {
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(transactionId)
        .update({
          collectionItems: updatedCollectionItems,
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
  } catch (err) {
    logger.error(
      `[syncCustomerAssetPossession] Failed for customer ${customerId}`,
      err,
    );
  }
}
