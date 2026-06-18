import type { Transaction } from "../services/transactions/transaction-service";

export const DEFAULT_SLA_BREACH_ALERT_PCT = 25;
export const DEFAULT_OPS_METRICS_DAYS = 30;

function parseTxDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null) {
    if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
      return (raw as { toDate: () => Date }).toDate();
    }
  }
  return null;
}

function isOperationalStop(tx: Transaction): boolean {
  if (tx.type !== "delivery" && tx.type !== "collection") return false;
  const status = String(tx.deliveryStatus || "").toLowerCase();
  return status !== "cancelled" && status !== "failed";
}

function isCompletedOperationalStop(tx: Transaction): boolean {
  if (!isOperationalStop(tx)) return false;
  const status = String(tx.deliveryStatus || "").toLowerCase();
  return status === "delivered" || status === "collected" || status === "completed";
}

function scheduledDateForStop(tx: Transaction): Date {
  return parseTxDate(tx.scheduledAt) ?? parseTxDate(tx.createdAt) ?? new Date(0);
}

function completionDateForStop(tx: Transaction): Date | null {
  if (!isCompletedOperationalStop(tx)) return null;
  return (
    parseTxDate((tx as { deliveredAt?: unknown }).deliveredAt) ??
    parseTxDate(tx.updatedAt) ??
    scheduledDateForStop(tx)
  );
}

export function turnaroundHoursForStop(tx: Transaction): number | null {
  const completed = completionDateForStop(tx);
  if (!completed) return null;
  const scheduled = scheduledDateForStop(tx);
  return Math.max(0, (completed.getTime() - scheduled.getTime()) / (1000 * 60 * 60));
}

export type DeliverySlaMetrics = {
  periodDays: number;
  completedStops: number;
  slaOver24hPct: number | null;
  slaBreachOver24hCount: number;
};

export function computeDeliverySlaMetrics(
  transactions: Transaction[],
  now = new Date(),
  periodDays = DEFAULT_OPS_METRICS_DAYS,
): DeliverySlaMetrics {
  const rangeStart = new Date(now.getTime() - periodDays * 86400000);
  let over24 = 0;
  let count = 0;

  for (const tx of transactions) {
    if (!isCompletedOperationalStop(tx)) continue;
    const completed = completionDateForStop(tx);
    if (!completed || completed < rangeStart || completed > now) continue;
    const hours = turnaroundHoursForStop(tx);
    if (hours == null) continue;
    count += 1;
    if (hours > 24) over24 += 1;
  }

  return {
    periodDays,
    completedStops: count,
    slaOver24hPct: count > 0 ? Math.round((over24 / count) * 100) : null,
    slaBreachOver24hCount: over24,
  };
}

export function slaBreachAlertActive(
  metrics: Pick<DeliverySlaMetrics, "slaOver24hPct" | "completedStops">,
  thresholdPct = DEFAULT_SLA_BREACH_ALERT_PCT,
  minSample = 5,
): boolean {
  if (metrics.completedStops < minSample) return false;
  return (metrics.slaOver24hPct ?? 0) >= thresholdPct;
}
