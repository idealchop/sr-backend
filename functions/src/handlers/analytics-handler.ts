import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import { CustomerService } from "../services/customers/customer-service";
import { TransactionService } from "../services/transactions/transaction-service";
import { buildDormantCustomerRows } from "../utils/dormant-customers";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
  paginateRows,
} from "../utils/analytics-utils";
import { checkBusinessAccess } from "../utils/auth-utils";

async function loadOperationalData(businessId: string) {
  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId),
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
  const thresholdDays = parseInt(String(req.query.thresholdDays || "7"), 10) || 7;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    const { customers, transactions } = await loadOperationalData(businessId);
    const rows = buildDormantCustomerRows(customers, transactions, { thresholdDays });
    const paginated = paginateRows(rows, page, limit);
    res.json(paginated);
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
          volumeUnits30d: countVolumeUnits30d(transactions),
          dormantCount: dormantRows.length,
          dormantPct,
          avgArDays,
          unpaidTotal: debtAging.rows.reduce((sum, row) => sum + row.amount, 0),
        };
      }),
    );

    rows.sort((a, b) => b.volumeUnits30d - a.volumeUnits30d);
    res.json({ data: rows });
  } catch (error) {
    logger.error("Error fetching multi-station benchmark:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
