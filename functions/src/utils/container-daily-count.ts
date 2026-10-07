/**
 * Counts water-container units on a ledger ticket.
 * A refill line counts only when its product icon has `waterContainer: true`
 * (round/slim gallons). Bottles and store accessories do not count unless
 * Sales Portal marks that icon as a water container.
 * Collections, expenses, and failed/cancelled stops never count.
 */

import {
  canonicalGallonIconId,
  DEFAULT_PRODUCT_ICON_ID,
} from "../services/products/product-icon-catalog";

export const CONTAINER_COUNT_TRANSACTION_TYPES = new Set([
  "delivery",
  "walkin",
  "direct_sale",
]);

const SKIP_REFILL_WATER_TYPE_IDS = new Set(["adjustment", "operating_expense"]);

export type ContainerCountRefill = {
  quantity?: number;
  qty?: number;
  productId?: string;
  waterTypeId?: string;
  name?: string;
  iconId?: string;
};

export type ContainerCountProduct = {
  itemOnly?: boolean;
  iconId?: string;
};

export type ContainerCountContext = {
  productById: Map<string, ContainerCountProduct>;
  waterContainerIconIds: Set<string>;
  defaultIconId: string;
};

export function transactionCountsTowardContainerCap(tx: {
  type?: string;
  deliveryStatus?: string;
}): boolean {
  const status = String(tx.deliveryStatus || "").toLowerCase();
  if (status === "failed" || status === "cancelled") return false;
  return CONTAINER_COUNT_TRANSACTION_TYPES.has(String(tx.type || "").toLowerCase());
}

export function buildWaterContainerIconIds(
  icons: ReadonlyArray<{ id?: string; waterContainer?: boolean }>,
): Set<string> {
  const ids = new Set<string>();
  for (const icon of icons) {
    const id = String(icon.id || "").trim();
    if (!id || icon.waterContainer !== true) continue;
    ids.add(id);
    const canonical = canonicalGallonIconId(id);
    if (canonical) ids.add(canonical);
  }
  if (!ids.has(DEFAULT_PRODUCT_ICON_ID)) {
    ids.add(DEFAULT_PRODUCT_ICON_ID);
  }
  return ids;
}

export function buildContainerCountContext(
  products: ReadonlyArray<{ id: string; itemOnly?: boolean; iconId?: string }>,
  icons: ReadonlyArray<{ id?: string; waterContainer?: boolean }>,
): ContainerCountContext {
  const productById = new Map<string, ContainerCountProduct>();
  for (const product of products) {
    productById.set(product.id, {
      itemOnly: product.itemOnly,
      iconId: product.iconId,
    });
  }
  return {
    productById,
    waterContainerIconIds: buildWaterContainerIconIds(icons),
    defaultIconId: DEFAULT_PRODUCT_ICON_ID,
  };
}

function iconCountsAsWaterContainer(
  iconId: string,
  waterContainerIconIds: Set<string>,
): boolean {
  if (waterContainerIconIds.has(iconId)) return true;
  const canonical = canonicalGallonIconId(iconId);
  return Boolean(canonical && waterContainerIconIds.has(canonical));
}

export function refillLooksLikeNonWaterContainer(line: {
  name?: string;
  waterTypeId?: string;
  productId?: string;
}): boolean {
  const text = [line.name, line.waterTypeId, line.productId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return false;
  if (/\bbottle\b/.test(text)) return true;
  if (/\b\d+\s*ml\b/.test(text) || /\b\d+ml\b/.test(text)) return true;
  if (/\b(350-ml|500-ml|1liter-bottle|1-liter|1l-bottle)\b/.test(text)) {
    return true;
  }
  return false;
}

function refillCountsAsWaterContainer(
  line: ContainerCountRefill,
  productById: Map<string, ContainerCountProduct>,
  waterContainerIconIds: Set<string>,
): boolean {
  const productId = String(line.productId || "").trim();
  const product = productId ? productById.get(productId) : undefined;
  if (product?.itemOnly) return false;
  const iconId = String(product?.iconId || line.iconId || "").trim();
  if (iconId) {
    return iconCountsAsWaterContainer(iconId, waterContainerIconIds);
  }
  if (refillLooksLikeNonWaterContainer(line)) return false;
  return true;
}

export function countWaterContainerQuantity(input: {
  type?: string;
  deliveryStatus?: string;
  waterRefills?: ContainerCountRefill[] | null;
  productById: Map<string, ContainerCountProduct>;
  waterContainerIconIds: Set<string>;
  defaultIconId: string;
}): number {
  if (!transactionCountsTowardContainerCap(input)) return 0;

  let total = 0;
  for (const line of input.waterRefills || []) {
    const waterTypeId = String(line.waterTypeId || "").trim().toLowerCase();
    if (SKIP_REFILL_WATER_TYPE_IDS.has(waterTypeId)) continue;
    const qty = Number(line.quantity ?? line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!refillCountsAsWaterContainer(line, input.productById, input.waterContainerIconIds)) {
      continue;
    }
    total += qty;
  }
  return total;
}
