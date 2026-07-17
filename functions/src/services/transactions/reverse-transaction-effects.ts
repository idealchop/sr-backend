import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { InventoryService } from "../inventory/inventory-service";
import {
  resolveStockInventoryLineId,
  transactionSkipsSalesInventoryStock,
} from "./transaction-line-inventory";
import {
  collectionLineStockUnits,
  isCollectionStockPhase,
} from "./transaction-stock-phases";
import { normalizeCollectionItems } from "./collection-item-utils";
import {
  shouldSyncWrContainerPossession,
  syncCustomerAssetPossession,
} from "./sync-customer-asset-possession";
import type { Transaction } from "./transaction-types";

/**
 * Reverses the effects of a transaction (inventory and possession).
 * @param {string} businessId The business ID.
 * @param {string} transactionId The transaction ID.
 * @param {Transaction} transaction The transaction data.
 * @param {string} [userId] The user ID of the person performing the action.
 */
export async function reverseTransactionEffects(
  businessId: string,
  transactionId: string,
  transaction: Transaction,
  userId?: string,
  userName?: string,
): Promise<void> {
  const customerId = transaction.customerId;

  // 1. Revert sold items (add back to stock) when dispatch had reduced inventory
  if (
    !transactionSkipsSalesInventoryStock(transaction.type, transaction.items) &&
    transaction.salesStockApplied !== false &&
    transaction.items &&
    transaction.items.length > 0
  ) {
    for (const item of transaction.items) {
      const invId = resolveStockInventoryLineId(item);
      if (!invId) continue;
      try {
        await InventoryService.adjustStock(
          businessId,
          invId,
          item.quantity, // Positive to add back
          {
            transactionId: transactionId,
            referenceId: transaction.referenceId,
            type: "void_reversal",
            customerId: transaction.customerId,
          },
        );
      } catch (err) {
        logger.error(`Failed to revert inventory for item ${invId}`, err);
      }
    }
  }

  // 2. Revert collection returns (remove credited serviceable qty from stock)
  if (
    isCollectionStockPhase(transaction.deliveryStatus) &&
    transaction.collectionItems &&
    transaction.collectionItems.length > 0
  ) {
    for (const item of transaction.collectionItems) {
      if (!item.inventoryId) continue;
      const units = collectionLineStockUnits(item);
      if (units !== 0) {
        try {
          await InventoryService.adjustStock(
            businessId,
            item.inventoryId,
            -units,
            {
              transactionId: transactionId,
              referenceId: transaction.referenceId,
              type: "void_reversal",
              customerId: transaction.customerId,
            },
          );
        } catch (err) {
          logger.error(
            `Failed to revert collection for item ${item.inventoryId}`,
            err,
          );
        }
      }

      // REVERT FIFO RECOVERY
      if (item.recoveredFromTxIds && item.recoveredFromTxIds.length > 0) {
        for (const pastTxId of item.recoveredFromTxIds) {
          try {
            const pastTxRef = db
              .collection("businesses")
              .doc(businessId)
              .collection("transactions")
              .doc(pastTxId);
            const pastTxSnap = await pastTxRef.get();

            if (pastTxSnap.exists) {
              const pastTx = pastTxSnap.data() as Transaction;
              const pastItems = pastTx.collectionItems || [];
              let pastTxChanged = false;

              const updatedPastItems = pastItems.map((pItem) => {
                if (
                  pItem.inventoryId !== item.inventoryId ||
                  !pItem.recoveryLinks
                ) {
                  return pItem;
                }

                const linkIndex = pItem.recoveryLinks.findIndex(
                  (l) => l.txId === transactionId,
                );

                if (linkIndex !== -1) {
                  // Found the link. Revert it.
                  const links = pItem.recoveryLinks;
                  const link = links[linkIndex];
                  const amountToRestore = link.amount;

                  pItem.qtyOk = Math.max(0, pItem.qtyOk - amountToRestore);
                  pItem.qtyCollected = pItem.qtyOk;
                  pItem.deficitQty += amountToRestore;

                  // Remove this specific link
                  links.splice(linkIndex, 1);
                  if (links.length === 0) pItem.recoveryLinks = undefined;

                  // Re-normalize to fix status
                  const normalized =
                    normalizeCollectionItems([pItem])[0];
                  Object.assign(pItem, normalized);

                  pastTxChanged = true;
                }
                return pItem;
              });

              if (pastTxChanged) {
                const normalized =
                  normalizeCollectionItems(updatedPastItems);
                await pastTxRef.update({
                  collectionItems: normalized,
                  updatedAt: FieldValue.serverTimestamp(),
                });
                logger.info(
                  `FIFO Reversal: Undid recovery in TX ${pastTxId} ` +
                    `for item ${item.inventoryId}`,
                );
              }
            }
          } catch (err) {
            logger.error(
              `Failed to revert FIFO recovery in TX ${pastTxId}`,
              err,
            );
          }
        }
      }
    }
  }

  // 3. Revert customer possession
  if (customerId && (await shouldSyncWrContainerPossession(businessId, customerId))) {
    await syncCustomerAssetPossession(
      businessId,
      customerId,
      transaction.items || [],
      transaction.collectionItems || [],
      transactionId,
      userId,
      true, // isReverse
      userName,
    );
  }
}
