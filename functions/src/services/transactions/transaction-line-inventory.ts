type InventoryLineRef = {
  inventoryId?: string;
  itemId?: string;
};

/** Financial-only line IDs — never read or write Firestore inventory stock. */
export const NON_INVENTORY_LINE_IDS = new Set(["manual_item", "adjustment"]);

export function isStockTrackedInventoryId(
  inventoryId?: string | null,
): inventoryId is string {
  if (!inventoryId) return false;
  return !NON_INVENTORY_LINE_IDS.has(inventoryId);
}

export function resolveStockInventoryLineId(
  item: InventoryLineRef,
): string | undefined {
  const id = item.inventoryId || item.itemId;
  return isStockTrackedInventoryId(id) ? id : undefined;
}
