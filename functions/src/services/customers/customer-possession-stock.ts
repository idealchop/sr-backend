import { FieldValue } from "firebase-admin/firestore";
import {
  InventoryService,
  InsufficientStockError,
} from "../inventory/inventory-service";
import { logger } from "../observability/logging/logger";

export type CustomerPossessionRow = {
  quantity?: number;
  itemName?: string;
  /** When true, CRM save deducts this row from warehouse. Missing = inherit customer WRS policy. */
  deductFromStock?: boolean;
};

export type CustomerPossessionMap = Record<string, CustomerPossessionRow>;

export function possessionRowDeductsStock(
  row: CustomerPossessionRow | null | undefined,
  legacyCustomerDeducts: boolean,
): boolean {
  if (typeof row?.deductFromStock === "boolean") return row.deductFromStock;
  return legacyCustomerDeducts;
}

/** Possession rows that should move warehouse stock (qty > 0 and deduct on). */
export function toStockedPossession(
  possession: CustomerPossessionMap | null | undefined,
  legacyCustomerDeducts: boolean,
): CustomerPossessionMap {
  const out: CustomerPossessionMap = {};
  for (const [itemId, row] of Object.entries(possession || {})) {
    if (!possessionRowDeductsStock(row, legacyCustomerDeducts)) continue;
    const quantity = row?.quantity || 0;
    if (quantity <= 0) continue;
    out[itemId] = { quantity, itemName: row?.itemName };
  }
  return out;
}

/**
 * Applies warehouse stock changes when customer container possession changes.
 * Positive delta (more at customer) deducts from stock.current; negative restores.
 * @param {string} businessId The business ID.
 * @param {CustomerPossessionMap} oldPossession Prior possession map keyed by inventory item ID.
 * @param {CustomerPossessionMap} newPossession Updated possession map keyed by inventory item ID.
 * @param {Object} context Audit and assignment context.
 * @param {string} context.customerId The customer ID.
 * @param {string} context.customerName The customer display name.
 * @param {string} context.userId The user performing the change.
 * @param {string} context.reason Audit reason code (e.g. CUSTOMER_POSSESSION_UPDATE).
 * @return {Promise<void>}
 */
export async function applyCustomerPossessionStockDelta(
  businessId: string,
  oldPossession: CustomerPossessionMap,
  newPossession: CustomerPossessionMap,
  context: {
    customerId: string;
    customerName: string;
    userId: string;
    reason: string;
  },
): Promise<void> {
  const allItemIds = new Set([
    ...Object.keys(oldPossession),
    ...Object.keys(newPossession),
  ]);

  for (const itemId of allItemIds) {
    const oldQty = oldPossession[itemId]?.quantity || 0;
    const newQty = newPossession[itemId]?.quantity || 0;
    const delta = newQty - oldQty;

    if (delta === 0) continue;
    if (!itemId.trim()) {
      throw new Error("Item not found");
    }

    const itemName =
      newPossession[itemId]?.itemName ||
      oldPossession[itemId]?.itemName ||
      "Unknown item";

    try {
      await InventoryService.adjustStock(businessId, itemId, -delta, {
        customerId: context.customerId,
        customerName: context.customerName,
        userId: context.userId,
        reason: context.reason,
        type: delta > 0 ? "deduction" : "restoration",
      });
    } catch (error) {
      // Restoring stock for a deleted catalog row should not block CRM saves.
      if (
        delta < 0 &&
        error instanceof Error &&
        /item not found/i.test(error.message)
      ) {
        logger.warn(
          `Skipping stock restore for missing inventory item ${itemId}`,
          {
            businessId,
            customerId: context.customerId,
            reason: context.reason,
          },
        );
        continue;
      }
      throw error;
    }

    await InventoryService.createAssignment(businessId, {
      inventoryItemId: itemId,
      inventoryItemName: itemName,
      customerId: context.customerId,
      customerName: context.customerName,
      quantityAssigned: delta,
      date: FieldValue.serverTimestamp(),
    });
  }
}

export { InsufficientStockError };
