import type {
  CollectionItem,
  TransactionInventoryItem,
} from "./transaction-types";
import { resolveStockInventoryLineId } from "./transaction-line-inventory";

/** Delivery phases where sold line items are considered dispatched for stock. */
export const DISPATCH_STOCK_PHASES = new Set<string>([
  "placed",
  "in-transit",
  "delivered",
  "completed",
  "collected",
]);

/** Phases where returned containers (qtyOk) count toward warehouse stock. */
export const COLLECTION_STOCK_PHASES = new Set<string>([
  "delivered",
  "completed",
  "collected",
]);

export function isDispatchStockPhase(status: string | undefined): boolean {
  return !!status && DISPATCH_STOCK_PHASES.has(status);
}

export function isCollectionStockPhase(status: string | undefined): boolean {
  return !!status && COLLECTION_STOCK_PHASES.has(status);
}

/**
 * Stock returned to inventory from a collection line: serviceable units only.
 */
export function collectionLineStockUnits(item: CollectionItem): number {
  return Math.max(0, item.qtyOk || 0);
}

export function aggregateCollectionStockByInventoryId(
  items: CollectionItem[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    if (!item.inventoryId) continue;
    const units = collectionLineStockUnits(item);
    if (units === 0) continue;
    map.set(item.inventoryId, (map.get(item.inventoryId) || 0) + units);
  }
  return map;
}

export function aggregateSalesQtyByInventoryId(
  items: TransactionInventoryItem[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    const invId = resolveStockInventoryLineId(item);
    if (!invId) continue;
    map.set(invId, (map.get(invId) || 0) + item.quantity);
  }
  return map;
}
