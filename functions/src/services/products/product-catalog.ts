import { DEFAULT_PRODUCT_ICON_ID } from "./product-icon-catalog";
import type {
  DeliveryProduct,
  ProductComponent,
  ProductKind,
  ProductWriteInput,
  WaterTypeRow,
} from "./product-types";

export const DEFAULT_PRODUCT_PRICE = 30;
export const VIRTUAL_PRODUCT_PREFIX = "virtual:";

export function slugifyProductKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/_refill$/, "");
}

/**
 * Infers the seeded product icon from a catalog name.
 * Slim / Round gallon names map to those icons; everything else uses the default gallon.
 * @param {string} name Product or water-type name.
 * @return {string} Platform icon id.
 */
export function inferProductIconIdFromName(name: string): string {
  const key = name.trim().toLowerCase();
  if (/\bslim\b/.test(key)) return "slim-gallon";
  if (/\bround\b/.test(key)) return "round-gallon";
  return DEFAULT_PRODUCT_ICON_ID;
}

export function catalogKeyForProduct(
  product: Pick<DeliveryProduct, "name" | "legacyWaterName">,
): string {
  const legacy = String(product.legacyWaterName || "").trim();
  if (legacy) return legacy;
  return String(product.name || "").trim();
}

export function waterTypeIdForProduct(
  product: Pick<DeliveryProduct, "name" | "legacyWaterName">,
): string {
  return slugifyProductKey(catalogKeyForProduct(product) || "water");
}

export function normalizeWaterTypeRows(raw: unknown): WaterTypeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: WaterTypeRow[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    let water = "";
    let price = DEFAULT_PRODUCT_PRICE;
    let iconId: string | undefined;
    if (typeof entry === "string") {
      water = entry.trim();
    } else if (entry && typeof entry === "object") {
      const row = entry as {
        water?: unknown;
        name?: unknown;
        price?: unknown;
        iconId?: unknown;
      };
      water = String(row.water || row.name || "").trim();
      const parsed = Number(row.price);
      if (Number.isFinite(parsed) && parsed >= 0) price = parsed;
      const rawIcon = typeof row.iconId === "string" ? row.iconId.trim() : "";
      if (rawIcon) iconId = rawIcon;
    }
    if (!water) continue;
    const key = water.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      water,
      price,
      iconId: iconId || inferProductIconIdFromName(water),
    });
  }
  return out;
}

/** Round and Slim, used only when a station has no products and no water types. */
export const DEFAULT_STARTER_WATER_TYPES: WaterTypeRow[] = [
  { water: "Round", price: DEFAULT_PRODUCT_PRICE, iconId: "round-gallon" },
  { water: "Slim", price: DEFAULT_PRODUCT_PRICE, iconId: "slim-gallon" },
];

export function defaultStarterProducts(): Omit<DeliveryProduct, "id">[] {
  return seedProductsFromWaterTypes(DEFAULT_STARTER_WATER_TYPES);
}

export function seedProductsFromWaterTypes(
  waterTypes: unknown,
): Omit<DeliveryProduct, "id">[] {
  return normalizeWaterTypeRows(waterTypes).map((row, index) => ({
    name: row.water,
    unitPrice: row.price,
    active: true,
    showInCustomerOrder: true,
    defaultForOrder: false,
    itemOnly: false,
    iconId: row.iconId || inferProductIconIdFromName(row.water),
    components: [],
    legacyWaterName: row.water,
    sortOrder: index,
  }));
}

export function derivedWaterTypesFromProducts(
  products: Array<
    Pick<DeliveryProduct, "active" | "itemOnly" | "name" | "legacyWaterName" | "unitPrice" | "sortOrder">
  >,
): WaterTypeRow[] {
  return products
    .filter((product) => product.active !== false && product.itemOnly !== true)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((product) => ({
      water: catalogKeyForProduct(product),
      price: Number(product.unitPrice) || 0,
    }))
    .filter((row) => row.water);
}

export function virtualProductsFromWaterTypes(
  waterTypes: unknown,
): DeliveryProduct[] {
  return seedProductsFromWaterTypes(waterTypes).map((row) => ({
    ...row,
    id: `${VIRTUAL_PRODUCT_PREFIX}${slugifyProductKey(row.name)}`,
  }));
}

export function resolveDeliveryCatalog(
  products: DeliveryProduct[],
  waterTypes: unknown,
): DeliveryProduct[] {
  if (products.length > 0) return products;
  return virtualProductsFromWaterTypes(waterTypes);
}

export function isVirtualProductId(productId: string | undefined): boolean {
  return Boolean(productId?.startsWith(VIRTUAL_PRODUCT_PREFIX));
}

export function inferProductKind(
  product: Pick<DeliveryProduct, "kind" | "components">,
): ProductKind {
  if (product.kind === "stock" || product.kind === "bundle" || product.kind === "service") {
    return product.kind;
  }
  const linked = product.components?.length ?? 0;
  if (linked >= 2) return "bundle";
  if (linked === 1) return "stock";
  return "service";
}

function optionalLabel(value: unknown): string {
  return String(value || "").trim();
}

export function parseProductComponents(raw: unknown): ProductComponent[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductComponent[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { inventoryItemId?: unknown; quantity?: unknown };
    const inventoryItemId = String(row.inventoryItemId || "").trim();
    const parsedQty = Number(row.quantity);
    const quantity =
      Number.isFinite(parsedQty) && parsedQty > 0 ? Math.floor(parsedQty) : 1;
    if (!inventoryItemId) continue;
    if (seen.has(inventoryItemId)) continue;
    seen.add(inventoryItemId);
    out.push({ inventoryItemId, quantity });
  }
  return out;
}

export class ProductValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductValidationError";
  }
}

export function parseProductWrite(
  input: ProductWriteInput,
  options?: { requireName?: boolean },
): Partial<DeliveryProduct> {
  const out: Partial<DeliveryProduct> = {};

  if (input.name !== undefined || options?.requireName) {
    const name = String(input.name || "").trim();
    if (!name) {
      throw new ProductValidationError("Product name is required.");
    }
    out.name = name;
  }

  if (input.unitPrice !== undefined || options?.requireName) {
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ProductValidationError("Product price must be a number 0 or greater.");
    }
    out.unitPrice = unitPrice;
  }

  if (input.active !== undefined) {
    out.active = input.active !== false;
  }
  if (input.showInCustomerOrder !== undefined) {
    out.showInCustomerOrder = input.showInCustomerOrder !== false;
  }
  if (input.defaultForOrder !== undefined) {
    out.defaultForOrder = input.defaultForOrder === true;
  }
  if (input.itemOnly !== undefined) {
    out.itemOnly = input.itemOnly === true;
  }
  if (input.iconId !== undefined) {
    const iconId = String(input.iconId || "").trim();
    out.iconId = iconId || undefined;
  }
  if (input.kind !== undefined) {
    const kind = String(input.kind || "").trim();
    if (kind !== "stock" && kind !== "bundle" && kind !== "service") {
      throw new ProductValidationError("Product kind must be sold as-is, bundle, or no stock item.");
    }
    out.kind = kind;
  }
  if (input.family !== undefined) out.family = optionalLabel(input.family);
  if (input.variantLabel !== undefined) out.variantLabel = optionalLabel(input.variantLabel);
  if (input.containerItemId !== undefined) {
    out.containerItemId = optionalLabel(input.containerItemId);
  }
  if (input.sourceInventoryItemId !== undefined) {
    out.sourceInventoryItemId = optionalLabel(input.sourceInventoryItemId);
  }
  if (input.components !== undefined) {
    out.components = parseProductComponents(input.components);
  }
  if (input.legacyWaterName !== undefined) {
    const legacy = String(input.legacyWaterName || "").trim();
    out.legacyWaterName = legacy || undefined;
  }
  if (input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder);
    if (Number.isFinite(sortOrder)) out.sortOrder = sortOrder;
  }

  return out;
}

/** Align stored links with the product kind. Empty strings mean the field should be cleared. */
export function applyProductKindRules(parsed: Partial<DeliveryProduct>): void {
  if (!parsed.kind) return;
  const components = parsed.components ?? [];
  if (parsed.kind === "stock") {
    if (components.length !== 1) {
      throw new ProductValidationError("Sold as-is needs one warehouse item.");
    }
    parsed.sourceInventoryItemId = components[0].inventoryItemId;
    parsed.containerItemId = "";
  } else if (parsed.kind === "bundle") {
    if (components.length < 2) {
      throw new ProductValidationError("A bundle needs at least two warehouse items.");
    }
    parsed.sourceInventoryItemId = "";
    parsed.containerItemId = "";
  } else if (components.length > 0) {
    throw new ProductValidationError("A product with no warehouse item cannot deduct stock.");
  } else {
    parsed.components = [];
    parsed.sourceInventoryItemId = "";
  }
}

export function listCustomerOrderProducts<
  T extends Pick<DeliveryProduct, "active" | "showInCustomerOrder">,
>(products: T[]): T[] {
  return products.filter(
    (product) => product.active !== false && product.showInCustomerOrder !== false,
  );
}

export function findProductForRefillLine(
  products: DeliveryProduct[],
  line: { productId?: string; type?: string; name?: string; waterTypeId?: string },
): DeliveryProduct | undefined {
  const productId = String(line.productId || "").trim();
  if (productId && !isVirtualProductId(productId)) {
    const byId = products.find((product) => product.id === productId);
    if (byId) return byId;
  }

  const raw = String(line.type || line.name || line.waterTypeId || "").trim();
  if (!raw) return undefined;
  const slug = slugifyProductKey(raw.replace(/\s+refill$/i, ""));

  return products.find((product) => {
    const keys = [catalogKeyForProduct(product), product.name, product.legacyWaterName || ""]
      .map((value) => slugifyProductKey(value))
      .filter(Boolean);
    return keys.includes(slug);
  });
}

export type InventoryLineDraft = {
  inventoryId: string;
  name?: string;
  quantity: number;
  unitPrice?: number;
  subtotal?: number;
};

/** Merge BOM components as ₱0 stock lines so refill price stays on waterRefills. */
export function mergeBomInventoryLines(
  existing: InventoryLineDraft[],
  products: DeliveryProduct[],
  refillLines: Array<{
    productId?: string;
    type?: string;
    name?: string;
    waterTypeId?: string;
    qty?: number;
    quantity?: number;
  }>,
  itemNames: Record<string, string>,
): InventoryLineDraft[] {
  const merged = new Map<string, InventoryLineDraft>();
  for (const item of existing) {
    const inventoryId = String(item.inventoryId || "").trim();
    if (!inventoryId) continue;
    merged.set(inventoryId, {
      ...item,
      inventoryId,
      quantity: Number(item.quantity) || 0,
    });
  }

  for (const line of refillLines) {
    const product = findProductForRefillLine(products, line);
    if (!product?.components?.length) continue;
    const qty = Math.max(0, Math.floor(Number(line.qty ?? line.quantity) || 0));
    if (qty <= 0) continue;
    for (const component of product.components) {
      const addQty = component.quantity * qty;
      const previous = merged.get(component.inventoryItemId);
      const nextQty = (previous?.quantity || 0) + addQty;
      const unitPrice = previous?.unitPrice ?? 0;
      merged.set(component.inventoryItemId, {
        inventoryId: component.inventoryItemId,
        name: previous?.name || itemNames[component.inventoryItemId] || component.inventoryItemId,
        quantity: nextQty,
        unitPrice,
        subtotal: unitPrice * nextQty,
      });
    }
  }

  return [...merged.values()];
}

export function serializeProduct(
  id: string,
  data: DeliveryProduct | Record<string, unknown>,
): DeliveryProduct {
  const row = data as Record<string, unknown>;
  const name = String(row.name || "").trim();
  const unitPrice = Number(row.unitPrice);
  return {
    id,
    name,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : DEFAULT_PRODUCT_PRICE,
    active: row.active !== false,
    showInCustomerOrder: row.showInCustomerOrder !== false,
    defaultForOrder: row.defaultForOrder === true,
    itemOnly: row.itemOnly === true,
    iconId: typeof row.iconId === "string" && row.iconId.trim() ? row.iconId.trim() : undefined,
    kind:
      row.kind === "stock" || row.kind === "bundle" || row.kind === "service" ?
        row.kind :
        undefined,
    family: typeof row.family === "string" && row.family.trim() ? row.family.trim() : undefined,
    variantLabel:
      typeof row.variantLabel === "string" && row.variantLabel.trim() ?
        row.variantLabel.trim() :
        undefined,
    containerItemId:
      typeof row.containerItemId === "string" && row.containerItemId.trim() ?
        row.containerItemId.trim() :
        undefined,
    sourceInventoryItemId:
      typeof row.sourceInventoryItemId === "string" && row.sourceInventoryItemId.trim() ?
        row.sourceInventoryItemId.trim() :
        undefined,
    components: parseProductComponents(row.components),
    legacyWaterName:
      typeof row.legacyWaterName === "string" && row.legacyWaterName.trim() ?
        row.legacyWaterName.trim() :
        undefined,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function otherDefaultProductIds(
  products: Array<Pick<DeliveryProduct, "id" | "defaultForOrder">>,
  keepId: string,
): string[] {
  return products
    .filter((product) => product.id !== keepId && product.defaultForOrder === true)
    .map((product) => product.id);
}

export function duplicateNameExists(
  products: Array<Pick<DeliveryProduct, "id" | "name" | "legacyWaterName">>,
  name: string,
  excludeId?: string,
): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return products.some((product) => {
    if (excludeId && product.id === excludeId) return false;
    const keys = [product.name, product.legacyWaterName || ""].map((value) =>
      value.trim().toLowerCase(),
    );
    return keys.includes(needle);
  });
}
