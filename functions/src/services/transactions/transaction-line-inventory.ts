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

type StockSaleLine = {
  inventoryId?: string;
  itemId?: string;
  unitPrice?: number;
  subtotal?: number;
};

/** Paid inventory lines on a walk-in (container / store add-on). Refill-only has none. */
export function walkInHasStockSaleItems(items?: ReadonlyArray<StockSaleLine>): boolean {
  return (items ?? []).some((item) => {
    if (!resolveStockInventoryLineId(item)) return false;
    const price = item.unitPrice ?? item.subtotal ?? 0;
    return price > 0;
  });
}

/**
 * Walk-in refills are ledger-only unless priced inventory lines are present.
 * Expenses never touch stock.
 */
export function transactionSkipsSalesInventoryStock(
  transactionType?: string | null,
  items?: ReadonlyArray<StockSaleLine>,
): boolean {
  if (transactionType === "expense") return true;
  if (transactionType === "walkin") return !walkInHasStockSaleItems(items);
  return false;
}
