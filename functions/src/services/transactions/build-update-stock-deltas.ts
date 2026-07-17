import {
  resolveStockInventoryLineId,
  transactionSkipsSalesInventoryStock,
} from "./transaction-line-inventory";
import {
  aggregateCollectionStockByInventoryId,
  aggregateSalesQtyByInventoryId,
  isCollectionStockPhase,
  isDispatchStockPhase,
} from "./transaction-stock-phases";
import type {
  CollectionItem,
  Transaction,
  TransactionInventoryItem,
} from "./transaction-types";

export type UpdateStockDeltaPlan = {
  stockDeltas: Map<string, number>;
  itemsToCheck: Set<string>;
  becomingDispatched: boolean;
  didDispatchSalesInventory: boolean;
};

function mergeStockDelta(
  map: Map<string, number>,
  id: string,
  delta: number,
): void {
  map.set(id, (map.get(id) || 0) + delta);
}

/**
 * Pure planner for inventory deltas during `updateTransaction`.
 * Caller applies deltas inside the Firestore transaction.
 */
export function buildUpdateStockDeltaPlan(params: {
  current: Transaction;
  updates: Partial<Transaction>;
  nextDeliveryStatus: string | undefined;
  nextCollectionItems: CollectionItem[];
  skippingInventoryMutation: boolean;
}): UpdateStockDeltaPlan {
  const {
    current,
    updates,
    nextDeliveryStatus,
    nextCollectionItems,
    skippingInventoryMutation,
  } = params;

  const stockDeltas = new Map<string, number>();
  const itemsToCheck = new Set<string>();
  let becomingDispatched = false;
  let didDispatchSalesInventory = false;

  const stockEffectiveType = updates.type ?? current.type;
  if (
    skippingInventoryMutation ||
    stockEffectiveType === "expense" ||
    transactionSkipsSalesInventoryStock(
      stockEffectiveType,
      updates.items ?? current.items,
    )
  ) {
    return {
      stockDeltas,
      itemsToCheck,
      becomingDispatched,
      didDispatchSalesInventory,
    };
  }

  becomingDispatched =
    current.salesStockApplied === false &&
    isDispatchStockPhase(nextDeliveryStatus) &&
    !isDispatchStockPhase(current.deliveryStatus);

  if (becomingDispatched) {
    const lines = updates.items ?? current.items ?? [];
    const dispatchMap = aggregateSalesQtyByInventoryId(lines);
    for (const [invId, qty] of dispatchMap.entries()) {
      if (qty <= 0) continue;
      itemsToCheck.add(invId);
      mergeStockDelta(stockDeltas, invId, -qty);
    }
    didDispatchSalesInventory = true;
  }

  if (
    updates.items !== undefined &&
    !didDispatchSalesInventory &&
    current.salesStockApplied !== false
  ) {
    const oldItemsMap = new Map<string, number>();
    current.items?.forEach((item: TransactionInventoryItem) => {
      const invId = resolveStockInventoryLineId(item);
      if (!invId) return;
      oldItemsMap.set(invId, (oldItemsMap.get(invId) || 0) + item.quantity);
      itemsToCheck.add(invId);
    });

    const newItemsMap = new Map<string, number>();
    updates.items.forEach((item) => {
      const invId = resolveStockInventoryLineId(item);
      if (!invId) return;
      newItemsMap.set(invId, (newItemsMap.get(invId) || 0) + item.quantity);
      itemsToCheck.add(invId);
    });

    const allItemIds = new Set([
      ...oldItemsMap.keys(),
      ...newItemsMap.keys(),
    ]);
    for (const invId of allItemIds) {
      const oldQty = oldItemsMap.get(invId) || 0;
      const newQty = newItemsMap.get(invId) || 0;
      const delta = oldQty - newQty;
      if (delta !== 0) {
        itemsToCheck.add(invId);
        mergeStockDelta(stockDeltas, invId, delta);
      }
    }
  }

  const prevCollStock = isCollectionStockPhase(current.deliveryStatus) ?
    aggregateCollectionStockByInventoryId(current.collectionItems) :
    new Map<string, number>();
  const nextCollStock = isCollectionStockPhase(nextDeliveryStatus) ?
    aggregateCollectionStockByInventoryId(nextCollectionItems) :
    new Map<string, number>();

  const allCollIds = new Set([
    ...prevCollStock.keys(),
    ...nextCollStock.keys(),
  ]);
  for (const invId of allCollIds) {
    const oldNet = prevCollStock.get(invId) || 0;
    const updatedNet = nextCollStock.get(invId) || 0;
    const netDelta = updatedNet - oldNet;
    if (netDelta !== 0) {
      itemsToCheck.add(invId);
      mergeStockDelta(stockDeltas, invId, netDelta);
    }
  }

  return {
    stockDeltas,
    itemsToCheck,
    becomingDispatched,
    didDispatchSalesInventory,
  };
}
