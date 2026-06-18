import { db } from "../../config/firebase-admin";
import { TransactionService } from "../transactions/transaction-service";
import { CustomerService } from "../customers/customer-service";
import { buildDormantCustomerRows } from "../../utils/dormant-customers";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { ProductionShiftService } from "../plant/production-shift-service";
import { MaintenanceTemplateService } from "../plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../plant/maintenance-template-utils";

export type OwnerHubStationRow = {
  businessId: string;
  businessName: string;
  revenuePhp30d: number;
  collectionsPhp30d: number;
  dormantCount: number;
  dormantPct: number;
  avgArDays: number | null;
  unpaidTotalPhp: number;
  plantGallons7d: number;
  maintenanceCompliancePct: number;
  expansionReadinessScore: number;
  expansionBlockers: string[];
};

export type ExpansionRoiModel = {
  carryOverSukiPct: number;
  projectedMonthlyRevenuePhp: number;
  capexPhp: number;
  breakEvenMonths: number | null;
  assumptions: string[];
};

export type OwnerHubRollup = {
  ownerId: string;
  stationCount: number;
  periodDays: number;
  stations: OwnerHubStationRow[];
  totals: {
    revenuePhp30d: number;
    unpaidTotalPhp: number;
    dormantPct: number;
    plantGallons7d: number;
  };
  expansionRoi: ExpansionRoiModel;
};

function parseTxDate(raw: unknown): Date {
  if (!raw) return new Date(0);
  if (typeof raw === "string") return new Date(raw);
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

type BusinessTransactions = Awaited<
  ReturnType<typeof TransactionService.getTransactionsByBusiness>
>;

function sumRevenue30d(transactions: BusinessTransactions) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  let revenue = 0;
  let collections = 0;
  for (const tx of transactions) {
    const d = parseTxDate(tx.scheduledAt ?? tx.createdAt);
    if (d < cutoff) continue;
    if (tx.type === "expense") continue;
    if (tx.type === "collection") {
      collections += Number(tx.totalAmount) || 0;
      continue;
    }
    revenue += Number(tx.totalAmount) || 0;
  }
  return { revenue, collections };
}

/** SC-03 — expansion readiness score 0–100. */
export function computeExpansionReadinessScore(input: {
  dormantPct: number;
  avgArDays: number | null;
  maintenanceOverdue: number;
  plantGallons7d: number;
  openDeliveries?: number;
}): { score: number; blockers: string[] } {
  let score = 100;
  const blockers: string[] = [];
  if (input.dormantPct > 25) {
    score -= 20;
    blockers.push("High dormant % — win back suki before expanding.");
  }
  if (input.avgArDays != null && input.avgArDays > 45) {
    score -= 15;
    blockers.push("AR aging above 45 days — tighten collections.");
  }
  if (input.maintenanceOverdue > 0) {
    score -= 10 * Math.min(input.maintenanceOverdue, 3);
    blockers.push("Overdue preventive maintenance — fix plant compliance.");
  }
  if (input.plantGallons7d < 100) {
    score -= 10;
    blockers.push("Low production volume — confirm capacity utilization.");
  }
  return { score: Math.max(0, Math.min(100, score)), blockers };
}

/** SC-10 — expansion ROI model from rollup actuals. */
export function buildExpansionRoiModel(rollup: OwnerHubRollup): ExpansionRoiModel {
  const avgRevenue =
    rollup.stationCount > 0 ?
      rollup.totals.revenuePhp30d / rollup.stationCount :
      0;
  const carryOverSukiPct = 35;
  const projectedMonthlyRevenuePhp = Math.round(avgRevenue * (carryOverSukiPct / 100) * 0.85);
  const capexPhp = 350000;
  const breakEvenMonths =
    projectedMonthlyRevenuePhp > 0 ?
      Math.ceil(capexPhp / projectedMonthlyRevenuePhp) :
      null;
  return {
    carryOverSukiPct,
    projectedMonthlyRevenuePhp,
    capexPhp,
    breakEvenMonths,
    assumptions: [
      "35% suki carry-over to new branch (conservative).",
      "₱350k capex placeholder (plant + bottles).",
      "Uses 30d average revenue per existing station.",
    ],
  };
}

/**
 * SC-01 / SC-03 / SC-10 — owner hub rollup across owned businesses.
 */
export async function buildOwnerHubRollup(
  ownerId: string,
  periodDays = 30,
): Promise<OwnerHubRollup> {
  const ownedSnap = await db
    .collection("businesses")
    .where("ownerId", "==", ownerId)
    .get();

  const businesses = ownedSnap.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data().name || "Station"),
  }));

  const stations: OwnerHubStationRow[] = await Promise.all(
    businesses.slice(0, 15).map(async (biz) => {
      const [customers, transactions, shifts, templates] = await Promise.all([
        CustomerService.getCustomersByBusiness(biz.id),
        TransactionService.getTransactionsByBusiness(biz.id, { limit: 200 }),
        ProductionShiftService.list(biz.id, { limit: 14 }),
        MaintenanceTemplateService.list(biz.id),
      ]);
      const dormantRows = buildDormantCustomerRows(customers, transactions);
      const debtAging = computeDebtAgingBreakdown(transactions, customers);
      const active = customers.filter((c) => c.status !== "inactive").length;
      const dormantPct = active > 0 ? Math.round((dormantRows.length / active) * 100) : 0;
      const avgArDays =
        debtAging.rows.length > 0 ?
          Math.round(
            debtAging.rows.reduce((s, r) => s + r.oldestDebtDays, 0) / debtAging.rows.length,
          ) :
          null;
      const { revenue, collections } = sumRevenue30d(transactions);
      const maintenance = summarizeMaintenanceOverdue(templates);
      const plantGallons7d = shifts
        .slice(0, 7)
        .reduce((s, r) => s + r.gallonsProduced, 0);
      const compliancePct =
        templates.length > 0 ?
          Math.round(
            ((templates.length - maintenance.overdueCount) / templates.length) * 100,
          ) :
          100;
      const readiness = computeExpansionReadinessScore({
        dormantPct,
        avgArDays,
        maintenanceOverdue: maintenance.overdueCount,
        plantGallons7d,
      });

      return {
        businessId: biz.id,
        businessName: biz.name,
        revenuePhp30d: Math.round(revenue * 100) / 100,
        collectionsPhp30d: Math.round(collections * 100) / 100,
        dormantCount: dormantRows.length,
        dormantPct,
        avgArDays,
        unpaidTotalPhp: Math.round(
          debtAging.rows.reduce((s, r) => s + r.amount, 0) * 100,
        ) / 100,
        plantGallons7d: Math.round(plantGallons7d),
        maintenanceCompliancePct: compliancePct,
        expansionReadinessScore: readiness.score,
        expansionBlockers: readiness.blockers,
      };
    }),
  );

  const rollup: OwnerHubRollup = {
    ownerId,
    stationCount: stations.length,
    periodDays,
    stations,
    totals: {
      revenuePhp30d: stations.reduce((s, r) => s + r.revenuePhp30d, 0),
      unpaidTotalPhp: stations.reduce((s, r) => s + r.unpaidTotalPhp, 0),
      dormantPct:
        stations.length > 0 ?
          Math.round(stations.reduce((s, r) => s + r.dormantPct, 0) / stations.length) :
          0,
      plantGallons7d: stations.reduce((s, r) => s + r.plantGallons7d, 0),
    },
    expansionRoi: {
      carryOverSukiPct: 35,
      projectedMonthlyRevenuePhp: 0,
      capexPhp: 350000,
      breakEvenMonths: null,
      assumptions: [],
    },
  };

  rollup.expansionRoi = buildExpansionRoiModel(rollup);
  return rollup;
}
