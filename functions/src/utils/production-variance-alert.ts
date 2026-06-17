import { coerceToDate, manilaDateKey } from "./philippine-datetime";
import type { ProductionShiftRecord } from "../services/plant/production-shift-types";
import type { Transaction } from "../services/transactions/transaction-service";

export const DEFAULT_PRODUCTION_VARIANCE_PCT = 8;

export function resolveProductionVariancePct(
  uiConfig?: Record<string, unknown> | null,
): number {
  const raw = Number(uiConfig?.productionVariancePct);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRODUCTION_VARIANCE_PCT;
  return Math.min(Math.max(raw, 1), 50);
}

function manilaTodayKey(now = new Date()): string {
  return manilaDateKey(now);
}

export function sumPlantGallonsForCalendarDate(
  shifts: ProductionShiftRecord[],
  calendarDate = manilaTodayKey(),
): number {
  return shifts
    .filter((row) => row.calendarDate === calendarDate)
    .reduce((sum, row) => sum + row.gallonsProduced, 0);
}

function isFulfilledForVolume(tx: Transaction): boolean {
  const st = tx.deliveryStatus || "";
  if (tx.type === "expense" || tx.type === "collection") return false;
  if (tx.type === "walkin" || tx.type === "direct_sale") {
    return st === "completed" || st === "delivered" || st === "collected";
  }
  return ["completed", "delivered", "collected"].includes(st);
}

function txVolumeUnits(tx: Transaction): number {
  const refills = tx.waterRefills ?? [];
  if (refills.length > 0) {
    return refills.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  }
  return (tx.items ?? []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0,
  );
}

function txEffectiveDateKey(tx: Transaction): string | null {
  const d = coerceToDate(tx.scheduledAt ?? tx.createdAt);
  if (!d) return null;
  return manilaDateKey(d);
}

function sumLedgerRefillUnitsForDate(
  transactions: Transaction[],
  dayKey: string,
): number {
  return transactions.reduce((sum, tx) => {
    if (!isFulfilledForVolume(tx)) return sum;
    const txDay = txEffectiveDateKey(tx);
    if (!txDay || txDay !== dayKey) return sum;
    return sum + txVolumeUnits(tx);
  }, 0);
}

export function buildProductionVarianceAlert(args: {
  shifts: ProductionShiftRecord[];
  transactions: Transaction[];
  uiConfig?: Record<string, unknown> | null;
  now?: Date;
}): {
  active: boolean;
  headline: string;
  plantGallons: number;
  soldUnits: number;
  variancePct: number;
} {
  const dayKey = manilaTodayKey(args.now);
  const plantGallons = sumPlantGallonsForCalendarDate(args.shifts, dayKey);
  const soldUnits = sumLedgerRefillUnitsForDate(args.transactions, dayKey);
  const threshold = resolveProductionVariancePct(args.uiConfig);

  if (plantGallons <= 0 || soldUnits <= 0) {
    return { active: false, headline: "", plantGallons, soldUnits, variancePct: 0 };
  }

  const variancePct = Math.abs((plantGallons - soldUnits) / plantGallons) * 100;
  if (variancePct < threshold) {
    return { active: false, headline: "", plantGallons, soldUnits, variancePct };
  }

  const direction =
    plantGallons > soldUnits ? "more produced than sold" : "more sold than produced";
  return {
    active: true,
    headline:
      `Plant vs sales mismatch today: ${Math.round(variancePct)}% ${direction} ` +
      `(${plantGallons.toLocaleString()} gal logged vs ` +
      `${soldUnits.toLocaleString()} refill units).`,
    plantGallons,
    soldUnits,
    variancePct,
  };
}
