import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import { CustomerService } from "../services/customers/customer-service";
import { TransactionService } from "../services/transactions/transaction-service";
import { AnalyticsMaterializerService } from
  "../services/analytics/analytics-materializer-service";
import { buildDormantCustomerRows } from "../utils/dormant-customers";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
  computeRevenueTrend,
  computeRevenueWowPct,
  paginateRows,
  sumRevenue30d,
} from "../utils/analytics-utils";
import { checkBusinessAccess } from "../utils/auth-utils";

/** Large ledgers use hybrid analytics above the FE threshold (250+ txs). */
const ANALYTICS_TX_LIMIT = 5000;

async function loadOperationalData(businessId: string) {
  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: ANALYTICS_TX_LIMIT }),
  ]);
  return { customers, transactions };
}

export const getBusinessAnalyticsSummary = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { customers, transactions } = await loadOperationalData(businessId);
    const dormantRows = buildDormantCustomerRows(customers, transactions);
    const debtAging = computeDebtAgingBreakdown(transactions, customers);
    const cohorts = computeCohortStats(transactions);

    res.json({
      businessId,
      metrics: {
        dormantCount: dormantRows.length,
        unpaidCustomerCount: debtAging.rows.length,
        newCustomers30d: cohorts.newCount,
        returningCustomers30d: cohorts.returningCount,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Error fetching analytics summary for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getDormantCustomersAnalytics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const page = parseInt(String(req.query.page || "1"), 10) || 1;
  const limit = parseInt(String(req.query.limit || "50"), 10) || 50;
  const thresholdDays = parseInt(String(req.query.thresholdDays || "15"), 10) || 15;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { customers, transactions } = await loadOperationalData(businessId);
    const rows = buildDormantCustomerRows(customers, transactions, { thresholdDays });
    const paginated = paginateRows(rows, page, limit);
    const revenueAtRiskTotal = Math.round(
      rows.reduce((sum, row) => sum + (row.estimatedRevenueAtRisk ?? 0), 0),
    );
    res.json({
      ...paginated,
      summary: {
        revenueAtRiskTotal,
        cadenceLateCount: rows.filter((row) => row.cadenceLate).length,
      },
    });
  } catch (error) {
    logger.error(`Error fetching dormant analytics for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getDebtAgingAnalytics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const page = parseInt(String(req.query.page || "1"), 10) || 1;
  const limit = parseInt(String(req.query.limit || "50"), 10) || 50;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { customers, transactions } = await loadOperationalData(businessId);
    const breakdown = computeDebtAgingBreakdown(transactions, customers);
    const paginated = paginateRows(breakdown.rows, page, limit);
    res.json({
      ...paginated,
      buckets: breakdown.buckets,
      summaryLabel: breakdown.summaryLabel,
      oldestDebtDays: breakdown.oldestDebtDays,
    });
  } catch (error) {
    logger.error(`Error fetching debt aging for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getCohortStatsAnalytics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const periodDays = parseInt(String(req.query.periodDays || "30"), 10) || 30;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { transactions } = await loadOperationalData(businessId);
    const stats = computeCohortStats(transactions, periodDays);
    res.json({ data: stats });
  } catch (error) {
    logger.error(`Error fetching cohort stats for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRevenueTrendAnalytics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const trendDays = Math.min(
    90,
    Math.max(7, parseInt(String(req.query.days || "14"), 10) || 14),
  );

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { transactions } = await loadOperationalData(businessId);
    const trend = computeRevenueTrend(transactions, trendDays);
    res.json({ data: trend });
  } catch (error) {
    logger.error(`Error fetching revenue trend for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Serving-layer stock KPIs (unpaid / dormant / cohorts / period presets). */
export const getDashboardAnalyticsSnapshot = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const refresh = String(req.query.refresh || "") === "1";

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    if (refresh) {
      await AnalyticsMaterializerService.materialize(businessId, {
        mode: "incremental",
        reason: "api_refresh",
      });
    }

    let snapshot = await AnalyticsMaterializerService.getDashboardSnapshot(businessId);
    if (!snapshot) {
      await AnalyticsMaterializerService.materialize(businessId, {
        mode: "incremental",
        reason: "api_miss",
      });
      snapshot = await AnalyticsMaterializerService.getDashboardSnapshot(businessId);
    }

    if (!snapshot) {
      res.status(404).json({ error: "Analytics snapshot unavailable" });
      return;
    }

    res.json({ data: snapshot });
  } catch (error) {
    logger.error(`Error fetching dashboard snapshot for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** Sum of analytics_daily docs for a Manila calendar range (period cards / health). */
export const getAnalyticsDailySum = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    if (!DATE_KEY_RE.test(from) || !DATE_KEY_RE.test(to)) {
      res.status(400).json({
        error: "Query params from and to are required as yyyy-MM-dd (Asia/Manila)",
      });
      return;
    }

    const sum = await AnalyticsMaterializerService.sumDailyRange(businessId, from, to);
    res.json({ data: sum });
  } catch (error) {
    logger.error(`Error summing analytics daily for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** Owner/admin force rebuild of stock + nearby daily rollups. */
export const postAnalyticsMaterialize = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const mode = String(req.body?.mode || "incremental") === "full" ? "full" : "incremental";

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }
    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "Only owners and admins can rebuild analytics" });
      return;
    }

    const result = await AnalyticsMaterializerService.materialize(businessId, {
      mode,
      reason: "api_post",
    });
    const snapshot = await AnalyticsMaterializerService.getDashboardSnapshot(businessId);
    res.json({ data: { ...result, snapshot } });
  } catch (error) {
    logger.error(`Error materializing analytics for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

async function listAccessibleBusinesses(userId: string) {
  const ownedSnapshot = await db
    .collection("businesses")
    .where("ownerId", "==", userId)
    .get();

  const owned = ownedSnapshot.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data().name || "Station"),
  }));

  let memberBusinesses: { id: string; name: string }[] = [];
  try {
    const memberSnapshot = await db
      .collectionGroup("members")
      .where("userId", "==", userId)
      .get();

    memberBusinesses = (
      await Promise.all(
        memberSnapshot.docs
          .filter((doc) => {
            const parentId = doc.ref.parent.parent?.id;
            return parentId && !owned.some((b) => b.id === parentId);
          })
          .map(async (doc) => {
            const businessRef = doc.ref.parent.parent;
            if (!businessRef) return null;
            const businessDoc = await businessRef.get();
            if (!businessDoc.exists) return null;
            return {
              id: businessRef.id,
              name: String(businessDoc.data()?.name || "Station"),
            };
          }),
      )
    ).filter((row): row is { id: string; name: string } => row != null);
  } catch {
    memberBusinesses = [];
  }

  return [...owned, ...memberBusinesses];
}

type BusinessTransactionList = Awaited<
  ReturnType<typeof TransactionService.getTransactionsByBusiness>
>;

function countVolumeUnits30d(transactions: BusinessTransactionList) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  let units = 0;
  for (const tx of transactions) {
    if (tx.type === "expense") continue;
    const scheduled =
      (tx.scheduledAt as any)?.toDate?.() ||
      (typeof tx.scheduledAt === "string" ? new Date(tx.scheduledAt) : tx.scheduledAt) ||
      (tx.createdAt as any)?.toDate?.() ||
      new Date(String(tx.createdAt || 0));
    if (!(scheduled instanceof Date) || Number.isNaN(scheduled.getTime()) || scheduled < cutoff) {
      continue;
    }
    let n = 0;
    for (const r of tx.waterRefills || []) n += Number(r.quantity) || 0;
    for (const i of tx.items || []) n += Number(i.quantity) || 0;
    units += n > 0 ? n : 1;
  }
  return units;
}

export const getMultiStationBenchmark = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const businesses = await listAccessibleBusinesses(user.uid);
    if (businesses.length < 2) {
      res.json({ data: [] });
      return;
    }

    const rows = await Promise.all(
      businesses.slice(0, 10).map(async (business) => {
        const { customers, transactions } = await loadOperationalData(business.id);
        const dormantRows = buildDormantCustomerRows(customers, transactions);
        const debtAging = computeDebtAgingBreakdown(transactions, customers);
        const activeCustomers = customers.filter((c) => c.status !== "inactive").length;
        const dormantPct =
          activeCustomers > 0 ? Math.round((dormantRows.length / activeCustomers) * 100) : 0;
        const avgArDays =
          debtAging.rows.length > 0 ?
            Math.round(
              debtAging.rows.reduce((sum, row) => sum + row.oldestDebtDays, 0) /
                  debtAging.rows.length,
            ) :
            null;

        return {
          businessId: business.id,
          businessName: business.name,
          revenue30d: Math.round(sumRevenue30d(transactions)),
          revenueWowPct: computeRevenueWowPct(transactions),
          volumeUnits30d: countVolumeUnits30d(transactions),
          dormantCount: dormantRows.length,
          dormantPct,
          avgArDays,
          unpaidTotal: debtAging.rows.reduce((sum, row) => sum + row.amount, 0),
        };
      }),
    );

    rows.sort((a, b) => b.revenue30d - a.revenue30d || b.volumeUnits30d - a.volumeUnits30d);
    res.json({ data: rows });
  } catch (error) {
    logger.error("Error fetching multi-station benchmark:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
