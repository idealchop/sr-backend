/**
 * Pure dashboard KPI materialization math shared by the full recount and the
 * incremental (projection-based) path. Same inputs → byte-identical outputs.
 */
import type { Customer } from "../customers/customer-service";
import type { Transaction } from "../transactions/transaction-service";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
  type DebtAgingBucket,
} from "../../utils/analytics-utils";
import { buildDormantCustomerRows } from "../../utils/dormant-customers";
import { computeSukiHealthScore } from "../../utils/suki-health-score";
import { coerceToDate, manilaDateKey } from "../../utils/philippine-datetime";
import {
  buildAnalyticsDailyRollups,
  manilaDayRangeKeys,
  sumAnalyticsDailyRange,
  type AnalyticsDailyRollup,
} from "../../utils/analytics-daily-rollup";

export type AnalyticsPresetId = "1m" | "3m" | "6m" | "1y";

export type AnalyticsPresetSummary = {
  revenueTotal: number;
  expensesTotal: number;
  netTotal: number;
  priorRevenueTotal: number;
  priorExpensesTotal: number;
  priorNetTotal: number;
  dayCount: number;
  priorDayCount: number;
};

/** Snapshot body without the server-written computedAt / reason fields. */
export type DashboardKpiSnapshotBody = {
  unpaid: {
    totalAmount: number;
    customerCount: number;
    oldestDebtDays: number | null;
    summaryLabel: string;
    buckets: DebtAgingBucket[];
  };
  dormant: {
    totalCount: number;
    revenueAtRiskTotal: number;
    cadenceLateCount: number;
    thresholdDays: number;
  };
  /** Cap of dormant customer ids for CRM Inactive tab (denorm-first FE). */
  dormantCustomerIds: string[];
  cohorts: {
    periodDays: number;
    newCount: number;
    returningCount: number;
    totalActive: number;
  };
  customerHealth: {
    totalSukis: number;
    avgHealthScore: number;
    healthyCount: number;
    stableCount: number;
    watchCount: number;
    atRiskCount: number;
    dormantCount: number;
    newCount: number;
    returningCount: number;
    returnRatePct: number | null;
    periodDays: number;
    thresholdDays: number;
    cohortBarDormantCount: number;
    cohortBarNewCount: number;
    cohortBarRestCount: number;
  };
  presets: Record<AnalyticsPresetId, AnalyticsPresetSummary>;
  ledgerWatermark: string | null;
  coverageStart: string | null;
  coverageTxCount: number;
};

const PRESET_DAYS: Record<AnalyticsPresetId, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

const DORMANT_IDS_CAP = 500;

export function resolveDormantThresholdDays(uiConfig: unknown): number {
  const raw =
    uiConfig && typeof uiConfig === "object" ?
      Number((uiConfig as { dormantThresholdDays?: number }).dormantThresholdDays) :
      NaN;
  if (raw === 21 || raw === 30) return raw;
  return 15;
}

function buildPresetsFromDailyMap(
  dailyMap: Map<string, AnalyticsDailyRollup>,
  now = new Date(),
): Record<AnalyticsPresetId, AnalyticsPresetSummary> {
  const presets = {} as Record<AnalyticsPresetId, AnalyticsPresetSummary>;
  for (const [id, days] of Object.entries(PRESET_DAYS) as [AnalyticsPresetId, number][]) {
    const current = manilaDayRangeKeys(days, now);
    const priorEndCursor = new Date(`${current.fromKey}T12:00:00+08:00`);
    priorEndCursor.setUTCDate(priorEndCursor.getUTCDate() - 1);
    const priorEndKey = manilaDateKey(priorEndCursor);
    const priorStartCursor = new Date(`${priorEndKey}T12:00:00+08:00`);
    priorStartCursor.setUTCDate(priorStartCursor.getUTCDate() - (days - 1));
    const priorStartKey = manilaDateKey(priorStartCursor);

    const curSum = sumAnalyticsDailyRange(dailyMap.values(), current.fromKey, current.toKey);
    const priorSum = sumAnalyticsDailyRange(dailyMap.values(), priorStartKey, priorEndKey);
    presets[id] = {
      revenueTotal: curSum.revenueTotal,
      expensesTotal: curSum.expensesTotal,
      netTotal: curSum.netTotal,
      priorRevenueTotal: priorSum.revenueTotal,
      priorExpensesTotal: priorSum.expensesTotal,
      priorNetTotal: priorSum.netTotal,
      dayCount: curSum.dayCount,
      priorDayCount: priorSum.dayCount,
    };
  }
  return presets;
}

function oldestCoverageStart(
  transactions: { createdAt?: unknown; scheduledAt?: unknown }[],
): string | null {
  let oldest: Date | null = null;
  for (const tx of transactions) {
    const d = coerceToDate(tx.scheduledAt) ?? coerceToDate(tx.createdAt);
    if (!d) continue;
    if (!oldest || d < oldest) oldest = d;
  }
  return oldest ? manilaDateKey(oldest) : null;
}

function newestLedgerWatermark(
  transactions: { createdAt?: unknown; updatedAt?: unknown }[],
): string | null {
  let newest: Date | null = null;
  for (const tx of transactions) {
    const d = coerceToDate(tx.updatedAt) ?? coerceToDate(tx.createdAt);
    if (!d) continue;
    if (!newest || d > newest) newest = d;
  }
  return newest ? newest.toISOString() : null;
}

/**
 * Computes the stock KPI snapshot body and every non-empty daily rollup.
 * @param {Customer[]} customers Customers in `orderBy(createdAt, desc)` order.
 * @param {Transaction[]} transactions Newest ledger rows in
 *   `orderBy(scheduledAt, desc).limit(ANALYTICS_MATERIALIZE_TX_LIMIT)` order.
 * @param {Object} options thresholdDays + now.
 * @return {Object} Snapshot body + full daily map.
 */
export function computeAnalyticsMaterialization(
  customers: Customer[],
  transactions: Transaction[],
  options: { thresholdDays: number; now: Date },
): { snapshot: DashboardKpiSnapshotBody; dailyMap: Map<string, AnalyticsDailyRollup> } {
  const { thresholdDays, now } = options;
  const debtAging = computeDebtAgingBreakdown(transactions, customers, now);
  const unpaidTotal = debtAging.rows.reduce((sum, row) => sum + row.amount, 0);
  const dormantRows = buildDormantCustomerRows(customers, transactions, {
    thresholdDays,
    now,
  });
  const cohorts = computeCohortStats(transactions, 30, now);

  const txsByCustomerId = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    if (!tx.customerId) continue;
    const bucket = txsByCustomerId.get(tx.customerId);
    if (bucket) bucket.push(tx);
    else txsByCustomerId.set(tx.customerId, [tx]);
  }

  let healthyCount = 0;
  let stableCount = 0;
  let watchCount = 0;
  let atRiskCount = 0;
  let scoreSum = 0;
  let scoredCount = 0;
  const dormantIdSet = new Set(dormantRows.map((row) => row.customerId));

  for (const customer of customers) {
    if (!customer.id || customer.status === "inactive") continue;
    const scoreRaw =
      typeof customer.healthScore === "number" && Number.isFinite(customer.healthScore) ?
        customer.healthScore :
        computeSukiHealthScore(
          customer,
          txsByCustomerId.get(customer.id) ?? [],
          transactions,
          now,
        );
    const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));
    scoreSum += score;
    scoredCount += 1;
    if (score >= 80) healthyCount += 1;
    else if (score >= 60) stableCount += 1;
    else if (score >= 40) watchCount += 1;
    else atRiskCount += 1;
  }

  const returnRatePct =
    cohorts.totalActive > 0 ?
      Math.round((cohorts.returningCount / cohorts.totalActive) * 100) :
      null;

  // Exclusive cohort bar: dormant → new (approx via cohort.newCount) → rest.
  const cohortBarDormantCount = dormantIdSet.size;
  const cohortBarNewCount = Math.min(
    cohorts.newCount,
    Math.max(0, scoredCount - cohortBarDormantCount),
  );
  const cohortBarRestCount = Math.max(
    0,
    scoredCount - cohortBarDormantCount - cohortBarNewCount,
  );

  const dormantCustomerIds = dormantRows
    .slice(0, DORMANT_IDS_CAP)
    .map((row) => row.customerId);

  const dailyMap = buildAnalyticsDailyRollups(transactions, null);
  const presets = buildPresetsFromDailyMap(dailyMap, now);

  const snapshot: DashboardKpiSnapshotBody = {
    unpaid: {
      totalAmount: Math.round(unpaidTotal * 100) / 100,
      customerCount: debtAging.rows.length,
      oldestDebtDays: debtAging.oldestDebtDays,
      summaryLabel: debtAging.summaryLabel,
      buckets: debtAging.buckets,
    },
    dormant: {
      totalCount: dormantRows.length,
      revenueAtRiskTotal: Math.round(
        dormantRows.reduce((sum, row) => sum + (row.estimatedRevenueAtRisk ?? 0), 0),
      ),
      cadenceLateCount: dormantRows.filter((row) => row.cadenceLate).length,
      thresholdDays,
    },
    dormantCustomerIds,
    cohorts: {
      periodDays: cohorts.periodDays,
      newCount: cohorts.newCount,
      returningCount: cohorts.returningCount,
      totalActive: cohorts.totalActive,
    },
    customerHealth: {
      totalSukis: scoredCount,
      avgHealthScore: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 0,
      healthyCount,
      stableCount,
      watchCount,
      atRiskCount,
      dormantCount: dormantRows.length,
      newCount: cohorts.newCount,
      returningCount: cohorts.returningCount,
      returnRatePct,
      periodDays: cohorts.periodDays,
      thresholdDays,
      cohortBarDormantCount,
      cohortBarNewCount,
      cohortBarRestCount,
    },
    presets,
    ledgerWatermark: newestLedgerWatermark(transactions),
    coverageStart: oldestCoverageStart(transactions),
    coverageTxCount: transactions.length,
  };

  return { snapshot, dailyMap };
}

/** Zero rollup for a day that no longer has activity. */
export function emptyDailyRollup(dateKey: string): AnalyticsDailyRollup {
  return {
    dateKey,
    revenueTotal: 0,
    revenueCash: 0,
    revenueOnline: 0,
    expensesTotal: 0,
    fulfilledCount: 0,
    paymentCount: 0,
  };
}

function sameRollup(a: AnalyticsDailyRollup, b: AnalyticsDailyRollup): boolean {
  return (
    a.revenueTotal === b.revenueTotal &&
    a.revenueCash === b.revenueCash &&
    a.revenueOnline === b.revenueOnline &&
    a.expensesTotal === b.expensesTotal &&
    a.fulfilledCount === b.fulfilledCount &&
    a.paymentCount === b.paymentCount
  );
}

/**
 * Daily docs whose rollup changed between two ledger states. Days that lost
 * all activity come back as zero rollups so stored docs don't keep stale sums.
 * @param {Map<string, AnalyticsDailyRollup>} before Prior rollups.
 * @param {Map<string, AnalyticsDailyRollup>} after New rollups.
 * @return {AnalyticsDailyRollup[]} Rollups to write.
 */
export function diffDailyRollups(
  before: Map<string, AnalyticsDailyRollup>,
  after: Map<string, AnalyticsDailyRollup>,
): AnalyticsDailyRollup[] {
  const changed: AnalyticsDailyRollup[] = [];
  for (const [dateKey, next] of after) {
    const prev = before.get(dateKey);
    if (!prev || !sameRollup(prev, next)) changed.push(next);
  }
  for (const dateKey of before.keys()) {
    if (!after.has(dateKey)) changed.push(emptyDailyRollup(dateKey));
  }
  return changed.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}
