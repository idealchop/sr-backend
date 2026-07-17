import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
  type DebtAgingBucket,
} from "../../utils/analytics-utils";
import { buildDormantCustomerRows } from "../../utils/dormant-customers";
import { computeSukiHealthScore } from "../../utils/suki-health-score";
import { coerceToDate, manilaDateKey } from "../../utils/philippine-datetime";
import {
  ANALYTICS_DAILY_VERSION,
  ANALYTICS_MATERIALIZE_TX_LIMIT,
  ANALYTICS_SNAPSHOT_VERSION,
  buildAnalyticsDailyRollups,
  incrementalMaterializeDateKeys,
  manilaDayRangeKeys,
  sumAnalyticsDailyRange,
  type AnalyticsDailyRollup,
} from "../../utils/analytics-daily-rollup";

export const DASHBOARD_KPIS_DOC_ID = "dashboard_kpis";

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

export type DashboardKpiSnapshotDoc = {
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
  computedAt: ReturnType<typeof FieldValue.serverTimestamp> | Date;
  ledgerWatermark: string | null;
  coverageStart: string | null;
  coverageTxCount: number;
  version: number;
  reason?: string;
};

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

/**
 * Writes materialized analytics_daily + analytics_snapshots/dashboard_kpis.
 * Event path uses debounced incremental rebuild; nightly uses full reconcile.
 */
export class AnalyticsMaterializerService {
  static dailyRef(businessId: string, dateKey: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_daily")
      .doc(dateKey);
  }

  static snapshotRef(businessId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_snapshots")
      .doc(DASHBOARD_KPIS_DOC_ID);
  }

  static async markDirty(businessId: string): Promise<void> {
    if (!businessId) return;
    await db.collection("businesses").doc(businessId).set(
      {
        analyticsDirtyAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  static async clearDirty(businessId: string): Promise<void> {
    if (!businessId) return;
    await db.collection("businesses").doc(businessId).set(
      {
        analyticsDirtyAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /**
   * Fire-and-forget after ledger mutations (Cloud Tasks upgrade path later).
   * Marks dirty immediately, then rebuilds stock + recent daily docs.
   * @param {string} businessId Workspace id.
   * @param {"incremental" | "full"} mode Rebuild width.
   */
  static scheduleMaterialize(
    businessId: string,
    mode: "incremental" | "full" = "incremental",
  ): void {
    if (!businessId) return;
    void AnalyticsMaterializerService.markDirty(businessId)
      .then(() =>
        AnalyticsMaterializerService.materialize(businessId, {
          mode,
          reason: "mutate",
        }),
      )
      .catch((error) => {
        logger.warn("scheduleMaterialize failed", { businessId, mode, error });
      });
  }

  /**
   * Rebuild stock snapshot and daily docs.
   * @param {string} businessId Workspace id.
   * @param {Object} options mode + reason.
   * @return {Promise<Object>} Outcome summary.
   */
  static async materialize(
    businessId: string,
    options: {
      mode?: "incremental" | "full";
      reason?: string;
      now?: Date;
    } = {},
  ): Promise<{
    businessId: string;
    mode: "incremental" | "full";
    daysWritten: number;
    coverageTxCount: number;
  }> {
    const mode = options.mode ?? "incremental";
    const reason = options.reason ?? mode;
    const now = options.now ?? new Date();

    const [businessSnap, customers, transactions] = await Promise.all([
      db.collection("businesses").doc(businessId).get(),
      CustomerService.getCustomersByBusiness(businessId),
      TransactionService.getTransactionsByBusiness(businessId, {
        limit: ANALYTICS_MATERIALIZE_TX_LIMIT,
      }),
    ]);

    const thresholdDays = resolveDormantThresholdDays(businessSnap.data()?.uiConfig);
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

    const dateKeys =
      mode === "full" ?
        null :
        new Set(incrementalMaterializeDateKeys(2, now));

    const dailyMap = buildAnalyticsDailyRollups(transactions, dateKeys);

    // Presets need a wide in-memory rollup even on incremental (from loaded txs).
    const fullDailyForPresets =
      mode === "full" ?
        dailyMap :
        buildAnalyticsDailyRollups(transactions, null);
    const presets = buildPresetsFromDailyMap(fullDailyForPresets, now);

    const daysToWrite =
      mode === "full" ?
        [...fullDailyForPresets.keys()] :
        [...(dateKeys ?? [])];

    const writer = db.bulkWriter();
    let daysWritten = 0;
    for (const dateKey of daysToWrite) {
      const rollup = (mode === "full" ? fullDailyForPresets : dailyMap).get(dateKey) ?? {
        dateKey,
        revenueTotal: 0,
        revenueCash: 0,
        revenueOnline: 0,
        expensesTotal: 0,
        fulfilledCount: 0,
        paymentCount: 0,
      };
      // Skip writing empty days on incremental to reduce writes.
      if (
        mode === "incremental" &&
        rollup.revenueTotal === 0 &&
        rollup.expensesTotal === 0 &&
        rollup.fulfilledCount === 0 &&
        rollup.paymentCount === 0
      ) {
        continue;
      }
      daysWritten += 1;
      writer.set(
        AnalyticsMaterializerService.dailyRef(businessId, dateKey),
        {
          ...rollup,
          computedAt: FieldValue.serverTimestamp(),
          version: ANALYTICS_DAILY_VERSION,
        },
        { merge: true },
      );
    }

    const snapshot: DashboardKpiSnapshotDoc = {
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
      computedAt: FieldValue.serverTimestamp(),
      ledgerWatermark: newestLedgerWatermark(transactions),
      coverageStart: oldestCoverageStart(transactions),
      coverageTxCount: transactions.length,
      version: ANALYTICS_SNAPSHOT_VERSION,
      reason,
    };

    writer.set(
      AnalyticsMaterializerService.snapshotRef(businessId),
      snapshot,
      { merge: true },
    );

    await writer.close();
    await AnalyticsMaterializerService.clearDirty(businessId);

    logger.info("analytics materialize complete", {
      businessId,
      mode,
      reason,
      daysWritten,
      coverageTxCount: transactions.length,
    });

    return {
      businessId,
      mode,
      daysWritten,
      coverageTxCount: transactions.length,
    };
  }

  /**
   * Sum stored analytics_daily docs for a Manila date range.
   * Falls back to materializing from ledger when docs are missing.
   * @param {string} businessId Workspace id.
   * @param {string} fromKey Inclusive yyyy-MM-dd.
   * @param {string} toKey Inclusive yyyy-MM-dd.
   * @return {Promise<Object>} Range sum + source.
   */
  static async sumDailyRange(
    businessId: string,
    fromKey: string,
    toKey: string,
  ): Promise<{
    from: string;
    to: string;
    dayCount: number;
    revenueTotal: number;
    revenueCash: number;
    revenueOnline: number;
    expensesTotal: number;
    fulfilledCount: number;
    netTotal: number;
    source: "analytics_daily" | "ledger_fallback";
    missingDays: number;
  }> {
    if (fromKey > toKey) {
      return AnalyticsMaterializerService.sumDailyRange(businessId, toKey, fromKey);
    }

    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_daily")
      .where("__name__", ">=", fromKey)
      .where("__name__", "<=", toKey)
      .get();

    const days: AnalyticsDailyRollup[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        dateKey: doc.id,
        revenueTotal: Number(data.revenueTotal) || 0,
        revenueCash: Number(data.revenueCash) || 0,
        revenueOnline: Number(data.revenueOnline) || 0,
        expensesTotal: Number(data.expensesTotal) || 0,
        fulfilledCount: Number(data.fulfilledCount) || 0,
        paymentCount: Number(data.paymentCount) || 0,
      };
    });

    const expectedDays = (() => {
      let count = 0;
      const cursor = new Date(`${fromKey}T12:00:00+08:00`);
      const end = new Date(`${toKey}T12:00:00+08:00`);
      while (cursor.getTime() <= end.getTime()) {
        count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return count;
    })();

    const missingDays = Math.max(0, expectedDays - days.length);
    // Prefer stored docs when at least half the window is present (partial OK).
    if (days.length > 0 && missingDays <= expectedDays / 2) {
      return {
        ...sumAnalyticsDailyRange(days, fromKey, toKey),
        source: "analytics_daily",
        missingDays,
      };
    }

    const transactions = await TransactionService.getTransactionsByBusiness(businessId, {
      limit: ANALYTICS_MATERIALIZE_TX_LIMIT,
    });
    const rollups = buildAnalyticsDailyRollups(transactions, null);
    return {
      ...sumAnalyticsDailyRange(rollups.values(), fromKey, toKey),
      source: "ledger_fallback",
      missingDays: expectedDays,
    };
  }

  /**
   * Read stock snapshot doc if present.
   * @param {string} businessId Workspace id.
   * @return {Promise<Object | null>} Snapshot JSON or null.
   */
  static async getDashboardSnapshot(businessId: string): Promise<Record<string, unknown> | null> {
    const snap = await AnalyticsMaterializerService.snapshotRef(businessId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const computedAt = coerceToDate(data.computedAt);
    return {
      businessId,
      ...data,
      computedAt: computedAt ? computedAt.toISOString() : null,
    };
  }
}
