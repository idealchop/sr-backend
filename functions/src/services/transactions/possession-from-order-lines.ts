import {
  containerShapeFromName,
  inferInventoryItemRole,
  type InventoryItemRole,
} from "../inventory/container-kit";
import type { ContainerDefaultPolicy } from "../customers/container-policy";
import { findProductForRefillLine } from "../products/product-catalog";
import type { DeliveryProduct } from "../products/product-types";
import type {
  Transaction,
  TransactionInventoryItem,
  TransactionRefill,
} from "./transaction-types";

export type InventoryRoleRow = {
  id?: string;
  name: string;
  inventoryRole?: unknown;
};

/** Delivery/collection lines that count as containers held (not general BOM stock). */
export function isContainerPossessionInventory(
  name: string,
  inventoryRole?: unknown,
): boolean {
  const role = inferInventoryItemRole(name, inventoryRole);
  return (
    role === "container_shell" ||
    role === "container_round" ||
    role === "container_slim"
  );
}

export function possessionHasPositiveQuantity(
  possession: Record<string, { quantity?: number }> | null | undefined,
): boolean {
  return Object.values(possession || {}).some(
    (row) => (Number(row?.quantity) || 0) > 0,
  );
}

export function orderAppliesContainerPossession(
  tx: Pick<Transaction, "type" | "deliveryStatus" | "salesStockApplied">,
): boolean {
  if (tx.type === "expense") return false;
  const status = tx.deliveryStatus;
  if (status === "cancelled" || status === "failed") return false;
  if (tx.type === "delivery") {
    if (tx.salesStockApplied === false) return false;
    return (
      !status ||
      status === "delivered" ||
      status === "collected" ||
      status === "completed"
    );
  }
  if (tx.type === "collection") {
    return (
      !status ||
      status === "collected" ||
      status === "completed" ||
      status === "delivered"
    );
  }
  return (
    !status ||
    status === "delivered" ||
    status === "completed" ||
    status === "collected"
  );
}

function findItemByRole(
  inventory: InventoryRoleRow[],
  role: InventoryItemRole,
): InventoryRoleRow | undefined {
  return inventory.find(
    (row) =>
      Boolean(row.id) &&
      inferInventoryItemRole(row.name, row.inventoryRole) === role,
  );
}

export function pickFallbackContainerItem(
  inventory: InventoryRoleRow[],
  policy: ContainerDefaultPolicy,
): { id: string; name: string } | null {
  const shell = findItemByRole(inventory, "container_shell");
  const round = findItemByRole(inventory, "container_round");
  const slim = findItemByRole(inventory, "container_slim");
  const pick =
    policy === "wrs_rotation" ?
      shell || round || slim :
      round || slim || shell;
  if (!pick?.id) return null;
  return { id: pick.id, name: pick.name };
}

/**
 * Container lines that should change held qty.
 * Ticket container SKUs win; otherwise refill gallons map to Slim/Round/shell.
 */
export function possessionDeliveryItemsFromOrder(
  items: TransactionInventoryItem[] | undefined,
  waterRefills: TransactionRefill[] | undefined,
  inventory: InventoryRoleRow[],
  products: DeliveryProduct[],
  policy: ContainerDefaultPolicy,
): TransactionInventoryItem[] {
  const inventoryById = new Map(
    inventory
      .filter((row) => Boolean(row.id))
      .map((row) => [row.id as string, row]),
  );

  const containerItems: TransactionInventoryItem[] = [];
  for (const item of items || []) {
    const id = String(item.inventoryId || item.itemId || "").trim();
    if (!id || !item.quantity || item.quantity <= 0) continue;
    const catalog = inventoryById.get(id);
    const name = item.name || catalog?.name || "";
    if (!isContainerPossessionInventory(name, catalog?.inventoryRole)) {
      continue;
    }
    containerItems.push({
      ...item,
      inventoryId: id,
      name: name || item.name,
    });
  }
  if (containerItems.length > 0) return containerItems;

  const byId = new Map<string, TransactionInventoryItem>();
  const add = (id: string, name: string, quantity: number) => {
    if (!id || quantity <= 0) return;
    const previous = byId.get(id);
    if (previous) {
      previous.quantity += quantity;
      return;
    }
    byId.set(id, {
      inventoryId: id,
      name,
      quantity,
      unitPrice: 0,
      subtotal: 0,
    });
  };

  const fallback = pickFallbackContainerItem(inventory, policy);

  for (const line of waterRefills || []) {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    const product = findProductForRefillLine(products, {
      productId: line.productId,
      type: line.waterTypeId,
      name: line.name,
      waterTypeId: line.waterTypeId,
    });

    let target: { id: string; name: string } | null = null;
    if (product) {
      for (const component of product.components || []) {
        const row = inventoryById.get(component.inventoryItemId);
        if (!row) continue;
        if (isContainerPossessionInventory(row.name, row.inventoryRole)) {
          target = { id: component.inventoryItemId, name: row.name };
          break;
        }
      }
      if (!target) {
        const shape =
          containerShapeFromName(product.name) ||
          containerShapeFromName(line.name || "");
        if (shape) {
          const row = findItemByRole(inventory, shape);
          if (row?.id) target = { id: row.id, name: row.name };
        }
      }
    } else {
      const shape = containerShapeFromName(line.name || line.waterTypeId || "");
      if (shape) {
        const row = findItemByRole(inventory, shape);
        if (row?.id) target = { id: row.id, name: row.name };
      }
    }
    if (!target) target = fallback;
    if (target) add(target.id, target.name, qty);
  }

  return [...byId.values()];
}

export type OrderPossessionTransaction = Pick<
  Transaction,
  | "type"
  | "deliveryStatus"
  | "salesStockApplied"
  | "items"
  | "waterRefills"
  | "collectionItems"
  | "deliveredAt"
  | "scheduledAt"
  | "createdAt"
> & { id?: string };

export type PossessionAssignmentEvent = {
  transactionId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantityAssigned: number;
  occurredAt: unknown;
  movement: "possess" | "return";
};

export function assignmentEventsFromOrders(
  transactions: OrderPossessionTransaction[],
  inventory: InventoryRoleRow[],
  products: DeliveryProduct[],
  policy: ContainerDefaultPolicy,
): PossessionAssignmentEvent[] {
  const events: PossessionAssignmentEvent[] = [];
  for (const tx of transactions) {
    if (!orderAppliesContainerPossession(tx)) continue;
    const transactionId = String(tx.id || "").trim();
    if (!transactionId) continue;
    const occurredAt = tx.deliveredAt || tx.scheduledAt || tx.createdAt;
    const delivery = possessionDeliveryItemsFromOrder(
      tx.items,
      tx.waterRefills,
      inventory,
      products,
      policy,
    );
    for (const item of delivery) {
      if (!item.quantity) continue;
      events.push({
        transactionId,
        inventoryItemId: item.inventoryId,
        inventoryItemName: item.name || "Container",
        quantityAssigned: item.quantity,
        occurredAt,
        movement: "possess",
      });
    }
    for (const item of tx.collectionItems || []) {
      if (!item.inventoryId) continue;
      const catalog = inventory.find((row) => row.id === item.inventoryId);
      const name = item.name || catalog?.name || "";
      if (!isContainerPossessionInventory(name, catalog?.inventoryRole)) {
        continue;
      }
      const qtyReturned = item.qtyOk || 0;
      const qtyReplaced = item.replacedFromInventory ?
        (item.qtyDamaged || 0) + (item.qtyMissing || 0) :
        0;
      if (qtyReturned > 0) {
        events.push({
          transactionId,
          inventoryItemId: item.inventoryId,
          inventoryItemName: name || "Container",
          quantityAssigned: -qtyReturned,
          occurredAt,
          movement: "return",
        });
      }
      if (qtyReplaced > 0) {
        events.push({
          transactionId,
          inventoryItemId: item.inventoryId,
          inventoryItemName: name || "Container",
          quantityAssigned: qtyReplaced,
          occurredAt,
          movement: "possess",
        });
      }
    }
  }
  return events;
}

export function netPossessionFromOrders(
  transactions: OrderPossessionTransaction[],
  inventory: InventoryRoleRow[],
  products: DeliveryProduct[],
  policy: ContainerDefaultPolicy,
): Record<string, { itemName: string; quantity: number }> {
  const net: Record<string, { itemName: string; quantity: number }> = {};
  const bump = (id: string, name: string, delta: number) => {
    if (!id || delta === 0) return;
    if (!net[id]) net[id] = { itemName: name, quantity: 0 };
    net[id].quantity = Math.max(0, net[id].quantity + delta);
    if (name) net[id].itemName = name;
  };

  for (const event of assignmentEventsFromOrders(
    transactions,
    inventory,
    products,
    policy,
  )) {
    bump(event.inventoryItemId, event.inventoryItemName, event.quantityAssigned);
  }

  // Txs without id still affect held qty (unit tests / legacy).
  for (const tx of transactions) {
    if (!orderAppliesContainerPossession(tx)) continue;
    if (String(tx.id || "").trim()) continue;
    const delivery = possessionDeliveryItemsFromOrder(
      tx.items,
      tx.waterRefills,
      inventory,
      products,
      policy,
    );
    for (const item of delivery) {
      bump(item.inventoryId, item.name || "Container", item.quantity);
    }
    for (const item of tx.collectionItems || []) {
      if (!item.inventoryId) continue;
      const catalog = inventory.find((row) => row.id === item.inventoryId);
      const name = item.name || catalog?.name || "";
      if (!isContainerPossessionInventory(name, catalog?.inventoryRole)) {
        continue;
      }
      const qtyReturned = item.qtyOk || 0;
      const qtyReplaced = item.replacedFromInventory ?
        (item.qtyDamaged || 0) + (item.qtyMissing || 0) :
        0;
      bump(item.inventoryId, name || "Container", qtyReplaced - qtyReturned);
    }
  }

  const out: Record<string, { itemName: string; quantity: number }> = {};
  for (const [id, row] of Object.entries(net)) {
    if (row.quantity > 0) out[id] = row;
  }
  return out;
}
