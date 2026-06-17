import { FieldValue } from "firebase-admin/firestore";
import {
  InventoryService,
  InsufficientStockError,
} from "../inventory/inventory-service";

export type CustomerPossessionMap = Record<
  string,
  { quantity?: number; itemName?: string }
>;

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

    await InventoryService.adjustStock(businessId, itemId, -delta, {
      customerId: context.customerId,
      customerName: context.customerName,
      userId: context.userId,
      reason: context.reason,
      type: delta > 0 ? "deduction" : "restoration",
    });

    const itemName =
      newPossession[itemId]?.itemName ||
      oldPossession[itemId]?.itemName ||
      "Unknown item";

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
