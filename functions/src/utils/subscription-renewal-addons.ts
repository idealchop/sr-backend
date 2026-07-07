import {
  buildAddonCatalogLookup,
  extractAddonLineItems,
  type AddonCatalogRow,
  type AddonLineItem,
} from "./subscription-addon-limit-boosts";

export type { AddonCatalogRow, AddonLineItem };

function isMonthlyAddonInterval(interval: string | undefined): boolean {
  const value = String(interval || "monthly").toLowerCase();
  return value === "monthly" || value === "month";
}

export function addonUnitPriceForCycle(
  catalog: AddonCatalogRow,
  billingCycle: "monthly" | "yearly",
): number {
  const base = Math.max(0, Number(catalog.price) || 0);
  if (billingCycle === "yearly" && isMonthlyAddonInterval(String(catalog.billingInterval || ""))) {
    return base * 12;
  }
  return base;
}

export function addonLineTotalForCycle(
  catalog: AddonCatalogRow,
  quantity: number,
  billingCycle: "monthly" | "yearly",
): number {
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty <= 0) return 0;
  const packUnit = Math.max(1, Number(catalog.unit) || 1);
  return qty * addonUnitPriceForCycle(catalog, billingCycle) * packUnit;
}

export type RenewalAddonCheckout = {
  addonLineItems: Array<{
    addonId: string;
    code?: string;
    quantity: number;
    lineTotal: number;
  }>;
  addonsTotal: number;
};

/**
 * Rebuilds add-on line items for renewal from the current subscription row.
 */
export function buildRenewalAddonCheckout(
  sub: Record<string, unknown>,
  catalogLookup: Map<string, AddonCatalogRow>,
  billingCycle: "monthly" | "yearly",
): RenewalAddonCheckout {
  const lines = extractAddonLineItems(sub);
  const addonLineItems: RenewalAddonCheckout["addonLineItems"] = [];
  let addonsTotal = 0;

  for (const line of lines) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (qty <= 0) continue;

    const catalog =
      catalogLookup.get(String(line.addonId || "")) ||
      catalogLookup.get(`code:${String(line.code || "").trim().toUpperCase()}`);
    if (!catalog || catalog.isActive === false) continue;

    const lineTotal = addonLineTotalForCycle(catalog, qty, billingCycle);
    if (lineTotal <= 0) continue;

    addonLineItems.push({
      addonId: catalog.id,
      code: String(catalog.code || line.code || "").trim() || undefined,
      quantity: qty,
      lineTotal,
    });
    addonsTotal += lineTotal;
  }

  return { addonLineItems, addonsTotal };
}

export function buildAddonCatalogLookupFromRows(
  rows: AddonCatalogRow[],
): Map<string, AddonCatalogRow> {
  return buildAddonCatalogLookup(rows);
}
