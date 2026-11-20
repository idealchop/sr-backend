/**
 * Verbatim copy of the pre-change (origin/dev 6f670e9) KPI math from
 * AnalyticsMaterializerService.materialize, used as an independent reference.
 * Only the Firestore reads/writes and computedAt/version/reason were removed.
 */
/* eslint-disable */
import type { Customer } from "../../../../services/customers/customer-service";
import type { Transaction } from "../../../../services/transactions/transaction-service";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
} from "../../../../utils/analytics-utils";
import { buildDormantCustomerRows } from "../../../../utils/dormant-customers";
import { computeSukiHealthScore } from "../../../../utils/suki-health-score";
import { coerceToDate, manilaDateKey } from "../../../../utils/philippine-datetime";
import {
  buildAnalyticsDailyRollups,
  manilaDayRangeKeys,
  sumAnalyticsDailyRange,
  type AnalyticsDailyRollup,
} from "../../../../utils/analytics-daily-rollup";

type AnalyticsPresetId = "1m" | "3m" | "6m" | "1y";
type AnalyticsPresetSummary = Record<string, number>;

const PRESET_DAYS: Record<AnalyticsPresetId, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

function resolveDormantThresholdDays(uiConfig: unknown): number {
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

export function legacyComputeSnapshot(
  customers: Customer[],
  transactions: Transaction[],
  thresholdDays: number,
  now: Date,
) {
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

    const DORMANT_IDS_CAP = 500;
    const dormantCustomerIds = dormantRows
      .slice(0, DORMANT_IDS_CAP)
      .map((row) => row.customerId);

    const fullDailyForPresets = buildAnalyticsDailyRollups(transactions, null);
    const presets = buildPresetsFromDailyMap(fullDailyForPresets, now);

    const snapshot = {
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
    return { snapshot, dailyMap: fullDailyForPresets };
}
