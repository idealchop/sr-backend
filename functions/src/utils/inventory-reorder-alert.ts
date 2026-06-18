import type { InventoryItem } from "../services/inventory/inventory-service";
import type { PeakDemandSummary } from "./peak-demand-analytics";

export const DEFAULT_REORDER_ALERT_DAYS_AHEAD = 3;
export const UI_CONFIG_REORDER_ALERT_DAYS_KEY = "reorderAlertDaysAhead";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type LowStockInventoryRow = {
  id: string;
  name: string;
  current: number;
  min: number;
  unit: string;
};

export type InventoryReorderAlert = {
  active: boolean;
  daysUntilPeak: number | null;
  peakDayLabel: string | null;
  lowStockItems: LowStockInventoryRow[];
  headline: string | null;
};

export function resolveReorderAlertDaysAhead(
  uiConfig?: Record<string, unknown> | null,
): number {
  const raw = uiConfig?.[UI_CONFIG_REORDER_ALERT_DAYS_KEY];
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 14) return Math.round(n);
  return DEFAULT_REORDER_ALERT_DAYS_AHEAD;
}

/** Shared low-stock detector for NT-09 / NT-27 / NT-74. */
export function listLowStockItems(inventory: InventoryItem[]): LowStockInventoryRow[] {
  return inventory
    .filter((item) => {
      const current = item.stock?.current ?? 0;
      const min = item.stock?.min ?? 0;
      return current <= min;
    })
    .map((item) => ({
      id: item.id ?? "",
      name: item.name,
      current: item.stock?.current ?? 0,
      min: item.stock?.min ?? 0,
      unit: item.stock?.unit || "units",
    }))
    .sort((a, b) => a.current - b.current || a.name.localeCompare(b.name));
}

function manilaWeekdayIndex(now: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
  }).format(now);
  return WEEKDAY_INDEX[short] ?? now.getDay();
}

function daysUntilWeekday(label: string, now: Date): number | null {
  const target = WEEKDAY_INDEX[label];
  if (target == null) return null;
  const today = manilaWeekdayIndex(now);
  let diff = target - today;
  if (diff <= 0) diff += 7;
  return diff;
}

/** BL-41 / NT-04 — low stock before busiest weekday window.
 * @param {InventoryItem[]} inventory Station inventory rows.
 * @param {PeakDemandSummary} peak Peak demand summary.
 * @param {Date} [now] Reference time (defaults to now).
 * @param {number} [daysAhead] Days before peak to alert.
 * @return {InventoryReorderAlert} Reorder alert snapshot.
 */
export function buildInventoryReorderAlert(
  inventory: InventoryItem[],
  peak: PeakDemandSummary,
  now = new Date(),
  daysAhead = DEFAULT_REORDER_ALERT_DAYS_AHEAD,
): InventoryReorderAlert {
  const lowStockItems = listLowStockItems(inventory);
  const peakDayLabel = peak.busiestDayLabel;
  const daysUntilPeak = peakDayLabel ? daysUntilWeekday(peakDayLabel, now) : null;

  const active =
    lowStockItems.length > 0 &&
    daysUntilPeak != null &&
    daysUntilPeak <= daysAhead;

  let headline: string | null = null;
  if (active && peakDayLabel) {
    const itemLabel =
      lowStockItems.length === 1 ?
        lowStockItems[0].name :
        `${lowStockItems.length} items`;
    headline =
      `Restock ${itemLabel} before ${peakDayLabel} ` +
      `(${daysUntilPeak} day${daysUntilPeak === 1 ? "" : "s"})`;
  }

  return {
    active,
    daysUntilPeak,
    peakDayLabel,
    lowStockItems,
    headline,
  };
}
