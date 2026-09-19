import {
  addManilaDateKey,
  manilaDateKey,
  manilaNoonFromDateKey,
  manilaPreferredDayNum,
} from "./philippine-datetime";
import {
  averageItemsFromRecentHits,
  forecastRecommendedAction,
  type ForecastAccuracyRollup,
  type ForecastKind,
  type ForecastPredictedItem,
  type ForecastRecommendedAction,
} from "./forecast-accuracy";

export type ForecastPreferredConfig = {
  enabled?: boolean;
  preferredDays?: number[];
};

export type ForecastCustomerInput = {
  id: string;
  name?: string;
  phone?: string;
  status?: string;
  deliveryConfig?: ForecastPreferredConfig;
  collectionConfig?: ForecastPreferredConfig;
  forecastAccuracyRollup?: ForecastAccuracyRollup;
  lastFulfilled?: {
    type?: string;
    waterRefills?: Array<{ type?: string; quantity?: number; qty?: number }>;
    collectionItems?: Array<{
      type?: string;
      name?: string;
      quantity?: number;
      qty?: number;
      qtyCollected?: number;
      qtyExpected?: number;
    }>;
  };
  lastFulfilledByKind?: {
    delivery?: ForecastCustomerInput["lastFulfilled"];
    collection?: ForecastCustomerInput["lastFulfilled"];
  };
};

export type OccupiedForecastSlot = {
  customerId: string;
  kind: ForecastKind;
  dateKey: string;
};

export type ForecastScheduleSuggestion = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  kind: ForecastKind;
  scheduledDate: string;
  predictedDate: string;
  rationale: string;
  source: "profile_delivery" | "profile_collection";
  reason: string;
  predictedQty: number;
  predictedItems: ForecastPredictedItem[];
  recommendedAction: ForecastRecommendedAction;
  outcome?: "pending" | "hit" | "missed";
};

const WINDOW_DAYS = 7;
const DEFAULT_QTY = 2;
const MAX_SUGGESTIONS = 400;

function uniquePreferredDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const out = new Set<number>();
  for (const raw of days) {
    const n = Number(raw);
    if (n >= 1 && n <= 7) out.add(n);
  }
  return [...out];
}

export function expandPreferredDaysToDateKeys(
  preferredDays: number[],
  windowStartKey: string,
  windowDays = WINDOW_DAYS,
): string[] {
  const wanted = new Set(uniquePreferredDays(preferredDays));
  if (wanted.size === 0) return [];
  const keys: string[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const dateKey = addManilaDateKey(windowStartKey, i);
    const preferredNum = manilaPreferredDayNum(manilaNoonFromDateKey(dateKey));
    if (wanted.has(preferredNum)) keys.push(dateKey);
  }
  return keys;
}

function occupiedKey(customerId: string, kind: ForecastKind, dateKey: string): string {
  return `${customerId}|${kind}|${dateKey}`;
}

function itemsFromLastFulfilled(
  customer: ForecastCustomerInput,
  kind: ForecastKind,
  fallbackType: string,
): ForecastPredictedItem[] {
  const last = customer.lastFulfilledByKind?.[kind] || customer.lastFulfilled;
  if (!last) return [{ type: fallbackType, qty: DEFAULT_QTY }];
  const lastKind = last.type === "collection" ? "collection" : "delivery";
  if (lastKind !== kind) return [{ type: fallbackType, qty: DEFAULT_QTY }];
  if (kind === "collection") {
    const source = last.collectionItems || [];
    const rows = source
      .map((row) => ({
        type: String(row.type || row.name || fallbackType),
        qty: Math.max(
          0,
          Number(row.quantity ?? row.qty ?? row.qtyCollected ?? row.qtyExpected) || 0,
        ),
      }))
      .filter((row) => row.qty > 0);
    return rows.length > 0 ? rows : [{ type: fallbackType, qty: DEFAULT_QTY }];
  }
  const rows = (last.waterRefills || [])
    .map((row) => ({
      type: String(row.type || fallbackType),
      qty: Math.max(0, Number(row.quantity ?? row.qty) || 0),
    }))
    .filter((row) => row.qty > 0);
  return rows.length > 0 ? rows : [{ type: fallbackType, qty: DEFAULT_QTY }];
}

function predictedQtyAndItems(
  customer: ForecastCustomerInput,
  kind: ForecastKind,
  fallbackType: string,
): { qty: number; items: ForecastPredictedItem[] } {
  const rollup = customer.forecastAccuracyRollup?.[kind];
  const fromHits = averageItemsFromRecentHits(rollup);
  if (fromHits && fromHits.length > 0) {
    return {
      qty: fromHits.reduce((sum, row) => sum + row.qty, 0),
      items: fromHits,
    };
  }
  const items = itemsFromLastFulfilled(customer, kind, fallbackType);
  return {
    qty: items.reduce((sum, row) => sum + row.qty, 0) || DEFAULT_QTY,
    items,
  };
}

export function buildScheduleWeekSuggestions(input: {
  customers: ForecastCustomerInput[];
  occupiedSlots: OccupiedForecastSlot[];
  windowStartKey?: string;
  fallbackWaterType?: string;
}): ForecastScheduleSuggestion[] {
  const windowStartKey = input.windowStartKey || manilaDateKey();
  const fallbackType = input.fallbackWaterType || "Purified";
  const occupied = new Set(
    input.occupiedSlots.map((slot) => occupiedKey(slot.customerId, slot.kind, slot.dateKey)),
  );
  const out: ForecastScheduleSuggestion[] = [];

  for (const customer of input.customers) {
    if (customer.status && customer.status !== "active") continue;
    const name = customer.name || "Suki";
    const configs: Array<{ kind: ForecastKind; config?: ForecastPreferredConfig; source: ForecastScheduleSuggestion["source"] }> = [
      { kind: "delivery", config: customer.deliveryConfig, source: "profile_delivery" },
      { kind: "collection", config: customer.collectionConfig, source: "profile_collection" },
    ];
    for (const { kind, config, source } of configs) {
      if (config && config.enabled === false) continue;
      const dateKeys = expandPreferredDaysToDateKeys(config?.preferredDays || [], windowStartKey);
      if (dateKeys.length === 0) continue;
      const predicted = predictedQtyAndItems(customer, kind, fallbackType);
      const recommendedAction = forecastRecommendedAction(customer.forecastAccuracyRollup?.[kind]);
      for (const dateKey of dateKeys) {
        if (occupied.has(occupiedKey(customer.id, kind, dateKey))) continue;
        const iso = `${dateKey}T04:00:00.000Z`;
        out.push({
          id: `${kind}-${customer.id}-${dateKey}`,
          customerId: customer.id,
          customerName: name,
          customerPhone: customer.phone,
          kind,
          scheduledDate: iso,
          predictedDate: dateKey,
          rationale: kind === "delivery" ? "Preferred delivery day" : "Preferred collection day",
          source,
          reason: `Preferred ${kind} day`,
          predictedQty: predicted.qty,
          predictedItems: predicted.items,
          recommendedAction,
          outcome: "pending",
        });
        if (out.length >= MAX_SUGGESTIONS) return out;
      }
    }
  }

  return out.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) ||
    a.customerName.localeCompare(b.customerName));
}

export function forecastWindowBounds(windowStartKey?: string): {
  windowStart: string;
  windowEnd: string;
} {
  const start = windowStartKey || manilaDateKey();
  return {
    windowStart: start,
    windowEnd: addManilaDateKey(start, WINDOW_DAYS - 1),
  };
}

function parseToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    const rec = value as { toDate?: () => Date; seconds?: number };
    if (typeof rec.toDate === "function") return rec.toDate();
    if (typeof rec.seconds === "number") return new Date(rec.seconds * 1000);
  }
  return null;
}

export function instantToManilaDateKey(value: unknown): string | null {
  const d = parseToDate(value);
  if (!d) return null;
  return manilaDateKey(d);
}

const OCCUPIED_STATUSES = new Set(["pending", "placed", "in-transit"]);
const NON_MATCHABLE_STATUSES = new Set(["cancelled", "failed"]);

export function isOccupiedForecastStatus(status: string | undefined): boolean {
  return OCCUPIED_STATUSES.has(String(status || "pending"));
}

export function isForecastMatchableStatus(status: string | undefined): boolean {
  return !NON_MATCHABLE_STATUSES.has(String(status || ""));
}

export function transactionForecastLines(
  tx: {
    type?: string;
    waterRefills?: Array<{ type?: string; quantity?: number; qty?: number }>;
    collectionItems?: Array<{
      type?: string;
      name?: string;
      quantity?: number;
      qty?: number;
      qtyCollected?: number;
      qtyExpected?: number;
    }>;
  },
  fallbackType = "Purified",
): ForecastPredictedItem[] {
  if (tx.type === "collection") {
    const rows = (tx.collectionItems || [])
      .map((row) => ({
        type: String(row.type || row.name || fallbackType),
        qty: Math.max(
          0,
          Number(row.quantity ?? row.qty ?? row.qtyCollected ?? row.qtyExpected) || 0,
        ),
      }))
      .filter((row) => row.qty > 0);
    return rows.length > 0 ? rows : [{ type: fallbackType, qty: 0 }];
  }
  const rows = (tx.waterRefills || [])
    .map((row) => ({
      type: String(row.type || fallbackType),
      qty: Math.max(0, Number(row.quantity ?? row.qty) || 0),
    }))
    .filter((row) => row.qty > 0);
  return rows.length > 0 ? rows : [{ type: fallbackType, qty: 0 }];
}
