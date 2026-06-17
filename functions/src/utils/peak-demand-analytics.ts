import { coerceToDate, PHILIPPINE_TIMEZONE } from "./philippine-datetime";
import type { Transaction } from "../services/transactions/transaction-service";

export const DEFAULT_PEAK_ANALYTICS_DAYS = 30;

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type PeakDemandPoint = {
  label: string;
  count: number;
};

export type PeakDemandSummary = {
  periodDays: number;
  busiestDayLabel: string | null;
  busiestHourLabel: string | null;
  busiestDayCount: number;
  busiestHourCount: number;
  volumeByWeekday: PeakDemandPoint[];
  volumeByHour: PeakDemandPoint[];
};

function manilaWeekdayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHILIPPINE_TIMEZONE,
    weekday: "short",
  }).format(d);
}

function manilaHourOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PHILIPPINE_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour : 0;
}

function formatHourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const hr = h % 12 || 12;
  return `${hr}${suffix}`;
}

function isFulfilledVolumeStop(tx: Transaction): boolean {
  if (tx.type === "expense") return false;
  if (tx.type === "walkin" || tx.type === "direct_sale") return true;
  if (tx.type === "delivery" || tx.type === "collection") {
    const status = String(tx.deliveryStatus || "").toLowerCase();
    return status === "delivered" || status === "completed" || status === "collected";
  }
  return false;
}

function stopVolumeUnits(tx: Transaction): number {
  const refills = (tx.waterRefills ?? []).reduce((sum, row) => {
    if (row.waterTypeId === "operating_expense") return sum;
    return sum + (Number(row.quantity) || 0);
  }, 0);
  const items = (tx.items ?? []).reduce(
    (sum, row) => sum + (Number(row.quantity) || 0),
    0,
  );
  const total = refills + items;
  return total > 0 ? total : 1;
}

function scheduledDateForStop(tx: Transaction): Date | null {
  return coerceToDate(tx.scheduledAt ?? tx.createdAt);
}

function pickBusiest(points: PeakDemandPoint[]): PeakDemandPoint | null {
  if (points.length === 0) return null;
  return points.reduce((best, cur) => (cur.count > best.count ? cur : best), points[0]);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Rolling peak demand from fulfilled stops (BL-41 / NT-04).
 * @param {Transaction[]} transactions Ledger transactions.
 * @param {Date} [now] Reference time (defaults to now).
 * @param {number} [periodDays] Rolling window length in days.
 * @return {PeakDemandSummary} Peak weekday/hour summary.
 */
export function computePeakDemandSummary(
  transactions: Transaction[],
  now = new Date(),
  periodDays = DEFAULT_PEAK_ANALYTICS_DAYS,
): PeakDemandSummary {
  const rangeEnd = now;
  const rangeStart = addDays(now, -(periodDays - 1));
  const weekdayMap = new Map<string, number>();
  const hourMap = new Map<string, number>();

  for (const day of WEEKDAY_ORDER) {
    weekdayMap.set(day, 0);
  }
  for (let h = 0; h < 24; h += 1) {
    hourMap.set(formatHourLabel(h), 0);
  }

  const startKey = rangeStart.toLocaleDateString("en-CA", {
    timeZone: PHILIPPINE_TIMEZONE,
  });
  const endKey = rangeEnd.toLocaleDateString("en-CA", {
    timeZone: PHILIPPINE_TIMEZONE,
  });

  for (const tx of transactions) {
    if (!isFulfilledVolumeStop(tx)) continue;
    const scheduled = scheduledDateForStop(tx);
    if (!scheduled) continue;
    const dayKey = scheduled.toLocaleDateString("en-CA", {
      timeZone: PHILIPPINE_TIMEZONE,
    });
    if (dayKey < startKey || dayKey > endKey) continue;

    const units = stopVolumeUnits(tx);
    const weekday = manilaWeekdayShort(scheduled);
    const hourLabel = formatHourLabel(manilaHourOfDay(scheduled));
    weekdayMap.set(weekday, (weekdayMap.get(weekday) ?? 0) + units);
    hourMap.set(hourLabel, (hourMap.get(hourLabel) ?? 0) + units);
  }

  const volumeByWeekday = WEEKDAY_ORDER.map((label) => ({
    label,
    count: weekdayMap.get(label) ?? 0,
  }));
  const volumeByHour = [...hourMap.entries()].map(([label, count]) => ({
    label,
    count,
  }));

  const busiestDay = pickBusiest(volumeByWeekday.filter((p) => p.count > 0));
  const busiestHour = pickBusiest(volumeByHour.filter((p) => p.count > 0));

  return {
    periodDays,
    busiestDayLabel: busiestDay?.label ?? null,
    busiestHourLabel: busiestHour?.label ?? null,
    busiestDayCount: busiestDay?.count ?? 0,
    busiestHourCount: busiestHour?.count ?? 0,
    volumeByWeekday,
    volumeByHour,
  };
}
