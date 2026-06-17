import type { ParsedPlanQuotas } from "./subscription-addon-plan-limits";

export type AddonLineItem = {
  addonId?: string;
  code?: string;
  quantity?: number;
  lineTotal?: number;
};

export type AddonLimitBoosts = {
  staffRider: number;
  staffAdmin: number;
  aiToolsMonthly: number;
  customers: number;
  transactionsDaily: number;
  onlineOrders: number;
};

export function emptyAddonLimitBoosts(): AddonLimitBoosts {
  return {
    staffRider: 0,
    staffAdmin: 0,
    aiToolsMonthly: 0,
    customers: 0,
    transactionsDaily: 0,
    onlineOrders: 0,
  };
}

/**
 * Reads purchased add-on lines from a subscription document.
 * @param {Record<string, unknown>} sub Subscription document data.
 * @return {AddonLineItem[]} Normalized add-on line items.
 */
export function extractAddonLineItems(
  sub: Record<string, unknown>,
): AddonLineItem[] {
  const top = sub.addonLineItems;
  if (Array.isArray(top)) {
    return top as AddonLineItem[];
  }
  const meta = sub.metadata;
  const metaAddonItems =
    meta && typeof meta === "object" ?
      (meta as { addonLineItems?: unknown }).addonLineItems :
      undefined;
  if (Array.isArray(metaAddonItems)) {
    return metaAddonItems as AddonLineItem[];
  }
  return [];
}

/**
 * Units of plan quota granted per purchased add-on quantity.
 * @param {Record<string, unknown>} catalog Add-on catalog document.
 * @return {number} Boost units per purchased quantity.
 */
export function addonBoostIncrementPerUnit(
  catalog: Record<string, unknown>,
): number {
  const meta = catalog.metadata;
  if (meta && typeof meta === "object") {
    const m = meta as Record<string, unknown>;
    const explicit = m.limitBoostPerUnit ?? m.limitBoost;
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
      return explicit;
    }
  }

  const featureKey = String(catalog.featureKey || "").toLowerCase();
  if (featureKey === "ai_prompt_pack") return 500;

  const unit = catalog.unit;
  if (typeof unit === "number" && Number.isFinite(unit) && unit > 0) {
    return unit;
  }
  return 1;
}

function addFiniteCap(base: number | null, boost: number): number | null {
  if (!boost || boost <= 0) return base;
  if (base === null) return null;
  return base + boost;
}

/**
 * Merges purchased add-on boosts into parsed plan quotas.
 * @param {ParsedPlanQuotas|null} quotas Base plan quotas.
 * @param {AddonLimitBoosts} boosts Add-on boost totals.
 * @return {ParsedPlanQuotas|null} Quotas with boosts applied.
 */
export function applyAddonBoostsToQuotas(
  quotas: ParsedPlanQuotas | null,
  boosts: AddonLimitBoosts,
): ParsedPlanQuotas | null {
  if (!quotas) return null;

  return {
    staffRiderMax: addFiniteCap(quotas.staffRiderMax, boosts.staffRider),
    staffAdminMax: addFiniteCap(quotas.staffAdminMax, boosts.staffAdmin),
    aiToolsMonthlyMax: addFiniteCap(quotas.aiToolsMonthlyMax, boosts.aiToolsMonthly),
    customersMax: addFiniteCap(quotas.customersMax, boosts.customers),
    transactionsDailyMax: addFiniteCap(
      quotas.transactionsDailyMax,
      boosts.transactionsDaily,
    ),
    onlineOrders:
      quotas.onlineOrders && boosts.onlineOrders > 0 ?
        {
          ...quotas.onlineOrders,
          max: quotas.onlineOrders.max + boosts.onlineOrders,
        } :
        quotas.onlineOrders,
    channelUsage: quotas.channelUsage,
  };
}

export type AddonCatalogRow = Record<string, unknown> & { id: string };

/**
 * Build lookup map by document id and catalog code.
 * @param {AddonCatalogRow[]} rows Catalog documents.
 * @return {Map<string, AddonCatalogRow>} Lookup by id and `code:…` keys.
 */
export function buildAddonCatalogLookup(
  rows: AddonCatalogRow[],
): Map<string, AddonCatalogRow> {
  const map = new Map<string, AddonCatalogRow>();
  for (const row of rows) {
    map.set(row.id, row);
    const code = String(row.code || "").trim().toUpperCase();
    if (code) map.set(`code:${code}`, row);
  }
  return map;
}

/**
 * Sum plan-limit boosts from purchased add-on line items on a subscription row.
 * @param {Record<string, unknown>} sub Subscription document data.
 * @param {Map<string, AddonCatalogRow>} catalogByKey Catalog lookup from `buildAddonCatalogLookup`.
 * @return {AddonLimitBoosts} Boost totals per limitation dimension.
 */
export function resolveAddonLimitBoostsFromLines(
  sub: Record<string, unknown>,
  catalogByKey: Map<string, AddonCatalogRow>,
): AddonLimitBoosts {
  const boosts = emptyAddonLimitBoosts();
  const lines = extractAddonLineItems(sub);
  if (lines.length === 0) return boosts;

  for (const line of lines) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (qty <= 0) continue;

    const catalog =
      catalogByKey.get(String(line.addonId || "")) ||
      catalogByKey.get(`code:${String(line.code || "").trim().toUpperCase()}`);
    if (!catalog) continue;

    const ext = String(catalog.extendsPlanLimitation || "none")
      .toLowerCase()
      .replace(/-/g, "_");
    const inc = addonBoostIncrementPerUnit(catalog) * qty;

    switch (ext) {
    case "staff_rider":
      boosts.staffRider += inc;
      break;
    case "staff_admin":
      boosts.staffAdmin += inc;
      break;
    case "ai_tools":
      boosts.aiToolsMonthly += inc;
      break;
    case "customers":
      boosts.customers += inc;
      break;
    case "transactions_daily":
      boosts.transactionsDaily += inc;
      break;
    case "online_orders":
      boosts.onlineOrders += inc;
      break;
    default:
      break;
    }
  }

  return boosts;
}
