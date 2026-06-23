import type { MaintenanceTemplateRecord } from "../services/plant/maintenance-template-types";
import type { WaterQualityLogRecord } from "../services/plant/water-quality-log-service";
import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";
import { manilaDateKey } from "./philippine-datetime";
import { summarizeMaintenanceOverdue } from "../services/plant/maintenance-template-utils";

export const WRS_GAP_LOOKBACK_DAYS = 90;
export const WRS_GAP_PRIOR_DAYS = 14;
export const WRS_LOW_RATING_MAX = 3;

const MS_DAY = 86_400_000;

export type WrsMaintenanceGapRow = {
  customerId: string;
  customerName: string;
  avgWrsRating: number;
  lowRatingEvents: number;
  overdueMaintenanceCount: number;
  failedTdsPrior14Days: number;
  correlated: boolean;
  insight: string;
};

export type WrsMaintenanceGapAnalysis = {
  overdueCount: number;
  lowRatingCount: number;
  failedTdsCount: number;
  correlatedCount: number;
  rows: WrsMaintenanceGapRow[];
  headline: string;
  footerInsight: string;
};

function parseTxDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null) {
    if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
      const d = (raw as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
  }
  return null;
}

function normalizeWrsRating(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v) || v < 1 || v > 5) return undefined;
  return v;
}

function ratingEventDate(tx: Transaction): Date | null {
  return (
    parseTxDate(tx.deliveredAt) ??
    parseTxDate(tx.scheduledAt) ??
    parseTxDate(tx.updatedAt) ??
    parseTxDate(tx.createdAt)
  );
}

/** True when at least one PM template was due on or before the rating day. */
export function wasPmOverdueAt(
  templates: MaintenanceTemplateRecord[],
  ratingDate: Date,
): boolean {
  const atKey = manilaDateKey(ratingDate);
  return templates.some((template) => template.nextDueAt <= atKey);
}

/** Failed product TDS readings in the 14 days before a rating event. */
export function countFailedTdsPriorToRating(
  logs: WaterQualityLogRecord[],
  ratingDate: Date,
  priorDays = WRS_GAP_PRIOR_DAYS,
): number {
  const endMs = ratingDate.getTime();
  const startMs = endMs - priorDays * MS_DAY;
  return logs.filter((log) => {
    if (log.locationTag !== "product" || log.pass !== false) return false;
    const recordedMs = new Date(log.recordedAt).getTime();
    return Number.isFinite(recordedMs) && recordedMs >= startMs && recordedMs < endMs;
  }).length;
}

function buildFooterInsight(args: {
  lowRatingCount: number;
  correlatedCount: number;
  overdueCount: number;
  failedTdsCount: number;
}): string {
  if (args.lowRatingCount === 0) {
    return "No WRS ratings ≤3★ in the last 90 days — plant gap correlation is quiet.";
  }
  if (args.correlatedCount > 0) {
    const parts: string[] = [];
    if (args.overdueCount > 0) parts.push(`${args.overdueCount} PM overdue now`);
    if (args.failedTdsCount > 0) parts.push(`${args.failedTdsCount} failed product TDS in lookback`);
    const context = parts.length ? ` (${parts.join("; ")})` : "";
    return `${args.correlatedCount} of ${args.lowRatingCount} low WRS rating${args.lowRatingCount === 1 ? "" : "s"} followed overdue PM or failed product TDS within 14 days${context}.`;
  }
  return `${args.lowRatingCount} low WRS rating${args.lowRatingCount === 1 ? "" : "s"} without recent PM or TDS gaps — check delivery timing and suki expectations.`;
}

/** MP-16 — correlate low WRS ratings with overdue PM or failed TDS in prior 14 days. */
export function analyzeWrsMaintenanceGaps(args: {
  templates: MaintenanceTemplateRecord[];
  customers: Customer[];
  transactions: Transaction[];
  qualityLogs: WaterQualityLogRecord[];
  now?: Date;
  lookbackDays?: number;
}): WrsMaintenanceGapAnalysis {
  const now = args.now ?? new Date();
  const lookbackDays = args.lookbackDays ?? WRS_GAP_LOOKBACK_DAYS;
  const lookbackStart = new Date(now.getTime() - lookbackDays * MS_DAY);
  const overdue = summarizeMaintenanceOverdue(args.templates);
  const customerName = new Map(args.customers.map((c) => [c.id, c.name]));

  type CustomerAccumulator = {
    ratings: number[];
    events: number;
    failedTdsPrior14Days: number;
    correlatedEvents: number;
  };

  const byCustomer = new Map<string, CustomerAccumulator>();

  for (const tx of args.transactions) {
    const wrs = normalizeWrsRating(tx.wrsRating);
    if (wrs == null || wrs > WRS_LOW_RATING_MAX) continue;
    const customerId = tx.customerId;
    if (!customerId) continue;

    const at = ratingEventDate(tx);
    if (!at || at < lookbackStart || at > now) continue;

    const failedTds = countFailedTdsPriorToRating(args.qualityLogs, at);
    const pmOverdue = wasPmOverdueAt(args.templates, at);
    const correlated = failedTds > 0 || pmOverdue;

    const acc = byCustomer.get(customerId) ?? {
      ratings: [],
      events: 0,
      failedTdsPrior14Days: 0,
      correlatedEvents: 0,
    };
    acc.ratings.push(wrs);
    acc.events += 1;
    acc.failedTdsPrior14Days = Math.max(acc.failedTdsPrior14Days, failedTds);
    if (correlated) acc.correlatedEvents += 1;
    byCustomer.set(customerId, acc);
  }

  const failedTdsCount = args.qualityLogs.filter((log) => {
    if (log.locationTag !== "product" || log.pass !== false) return false;
    const recordedMs = new Date(log.recordedAt).getTime();
    return (
      Number.isFinite(recordedMs) &&
      recordedMs >= lookbackStart.getTime() &&
      recordedMs <= now.getTime()
    );
  }).length;

  const rows: WrsMaintenanceGapRow[] = [];

  for (const [customerId, acc] of byCustomer) {
    const avg = acc.ratings.reduce((sum, rating) => sum + rating, 0) / acc.ratings.length;
    const correlated = acc.correlatedEvents > 0;
    rows.push({
      customerId,
      customerName: String(customerName.get(customerId) || "Customer"),
      avgWrsRating: Math.round(avg * 10) / 10,
      lowRatingEvents: acc.events,
      overdueMaintenanceCount: overdue.overdueCount,
      failedTdsPrior14Days: acc.failedTdsPrior14Days,
      correlated,
      insight:
        correlated ?
          acc.failedTdsPrior14Days > 0 && overdue.overdueCount > 0 ?
            "Low WRS after failed product TDS and overdue PM — review plant discipline." :
            acc.failedTdsPrior14Days > 0 ?
              "Low WRS followed failed product TDS within 14 days." :
              "Low WRS while PM was overdue — schedule maintenance." :
          "Low WRS without recent PM or TDS gaps — check delivery or suki expectations.",
    });
  }

  rows.sort((a, b) => a.avgWrsRating - b.avgWrsRating);
  const correlatedCount = rows.filter((row) => row.correlated).length;

  const headline =
    correlatedCount > 0 ?
      `${correlatedCount} suki${correlatedCount === 1 ? "" : "s"} with low WRS tied to overdue PM or failed TDS in the prior 14 days.` :
      rows.length > 0 ?
        `${rows.length} low WRS rating${rows.length === 1 ? "" : "s"} without a plant gap signal.` :
        "No WRS ratings ≤3★ in the lookback window.";

  return {
    overdueCount: overdue.overdueCount,
    lowRatingCount: rows.length,
    failedTdsCount,
    correlatedCount,
    rows: rows.slice(0, 10),
    headline,
    footerInsight: buildFooterInsight({
      lowRatingCount: rows.length,
      correlatedCount,
      overdueCount: overdue.overdueCount,
      failedTdsCount,
    }),
  };
}
