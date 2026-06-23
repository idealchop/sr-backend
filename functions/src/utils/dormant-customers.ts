import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";
import { isWalkInCustomerName } from "../services/ai/ledger-scan-customer-match";

export const DEFAULT_DORMANT_THRESHOLD_DAYS = 7;

export type DormantTier = "watch" | "at_risk" | "churned";

type DormantLastOrderType = "delivery" | "collection" | "walkin" | "direct_sale";

export type DormantCustomerRow = {
  customerId: string;
  name: string;
  phone?: string;
  daysSinceLastOrder: number;
  lastFulfilledAt: Date;
  lastOrderType: DormantLastOrderType;
  historicalOrderCount: number;
  avgCadenceDays: number | null;
  unpaidBalance: number;
  typicalVolume: number | null;
  tier: DormantTier;
  cadenceLate: boolean;
  estimatedRevenueAtRisk: number | null;
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const msPerDay = 86_400_000;
  const a = startOfDay(later).getTime();
  const b = startOfDay(earlier).getTime();
  return Math.round((a - b) / msPerDay);
}

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

function isFulfilled(tx: Transaction): boolean {
  if (tx.type === "walkin" || tx.type === "direct_sale") return true;
  if (tx.type === "collection") {
    const ds = tx.deliveryStatus;
    if (!ds) return true;
    return ["delivered", "completed", "collected"].includes(ds);
  }
  if (tx.type === "delivery") {
    const ds = tx.deliveryStatus || "";
    return ["delivered", "completed", "collected"].includes(ds);
  }
  return false;
}

function fulfilledType(tx: Transaction): DormantLastOrderType | null {
  if (!isFulfilled(tx)) return null;
  if (tx.type === "walkin") return null;
  if (tx.type === "collection") return "collection";
  if (tx.type === "direct_sale") return "direct_sale";
  if (tx.type === "delivery") return "delivery";
  return null;
}

function fulfilledDate(tx: Transaction): Date | null {
  if (!fulfilledType(tx)) return null;
  return (
    parseTxDate((tx as { deliveredAt?: unknown }).deliveredAt) ||
    parseTxDate(tx.updatedAt) ||
    parseTxDate(tx.scheduledAt) ||
    parseTxDate(tx.createdAt)
  );
}

function countUnits(tx: Transaction): number {
  let n = 0;
  for (const r of tx.waterRefills || []) n += Number(r.quantity) || 0;
  for (const i of tx.items || []) n += Number(i.quantity) || 0;
  for (const c of tx.collectionItems || []) {
    n += Number(c.qtyCollected ?? c.qtyExpected ?? 0) || 0;
  }
  return n;
}

function dormantTier(days: number): DormantTier {
  if (days >= 30) return "churned";
  if (days >= 14) return "at_risk";
  return "watch";
}

function inferAvgCadenceDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let sum = 0;
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = differenceInCalendarDays(sorted[i], sorted[i - 1]);
    if (gap > 0) {
      sum += gap;
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : null;
}

function customerIdsWithOpenPipeline(transactions: Transaction[]): Set<string> {
  const ids = new Set<string>();
  const terminal = new Set(["delivered", "completed", "cancelled", "failed", "collected"]);
  for (const tx of transactions) {
    if (!tx.customerId || tx.type !== "delivery") continue;
    const status = tx.deliveryStatus;
    if (status && !terminal.has(status)) ids.add(tx.customerId);
  }
  return ids;
}

export function buildDormantCustomerRows(
  customers: Customer[],
  transactions: Transaction[],
  options: { thresholdDays?: number; now?: Date } = {},
): DormantCustomerRow[] {
  const thresholdDays = options.thresholdDays ?? DEFAULT_DORMANT_THRESHOLD_DAYS;
  const today = startOfDay(options.now ?? new Date());
  const openPipeline = customerIdsWithOpenPipeline(transactions);

  const txsByCustomer = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.customerId || tx.type === "expense") continue;
    const arr = txsByCustomer.get(tx.customerId) || [];
    arr.push(tx);
    txsByCustomer.set(tx.customerId, arr);
  }

  const unpaidByCustomer = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.customerId || !isFulfilled(tx)) continue;
    const unpaid = tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial";
    if (unpaid && (Number(tx.balanceDue) || 0) > 0) {
      unpaidByCustomer.set(
        tx.customerId,
        (unpaidByCustomer.get(tx.customerId) || 0) + (Number(tx.balanceDue) || 0),
      );
    }
  }

  const rows: DormantCustomerRow[] = [];

  for (const customer of customers) {
    if (!customer.id || customer.status === "inactive") continue;
    if (isWalkInCustomerName(customer.name)) continue;
    if (openPipeline.has(customer.id)) continue;

    const custTxs = txsByCustomer.get(customer.id) || [];
    let lastDate: Date | null = null;
    let lastType: DormantLastOrderType | null = null;
    const denormAt =
      parseTxDate(customer.lastFulfilledAt) || parseTxDate(customer.lastOrderAt);
    if (
      denormAt &&
      (customer.lastFulfilledType === "delivery" ||
        customer.lastFulfilledType === "collection" ||
        customer.lastFulfilledType === "direct_sale")
    ) {
      lastDate = denormAt;
      lastType = customer.lastFulfilledType;
    }
    const fulfilledDates: Date[] = [];
    let historicalOrderCount = 0;

    for (const tx of custTxs) {
      const type = fulfilledType(tx);
      if (!type) continue;
      historicalOrderCount += 1;
      const activityDate = fulfilledDate(tx);
      if (!activityDate) continue;
      fulfilledDates.push(activityDate);
      if (!lastDate || activityDate > lastDate) {
        lastDate = activityDate;
        lastType = type;
      }
    }

    if (lastDate && lastType && historicalOrderCount === 0) {
      historicalOrderCount = 1;
      fulfilledDates.push(lastDate);
    }

    if (!lastDate || !lastType || historicalOrderCount === 0) continue;

    const daysSince = differenceInCalendarDays(today, startOfDay(lastDate));
    const avgCadenceDays = inferAvgCadenceDays(fulfilledDates);
    const cadenceGate =
      avgCadenceDays == null || avgCadenceDays <= 0 || daysSince >= avgCadenceDays;
    if (daysSince < thresholdDays || !cadenceGate) continue;

    const expectedByDate =
      avgCadenceDays != null ?
        startOfDay(new Date(lastDate.getTime() + avgCadenceDays * 86_400_000)) :
        null;
    const cadenceLate =
      expectedByDate != null && differenceInCalendarDays(today, expectedByDate) > 0;

    const recent = custTxs
      .filter((tx) => fulfilledType(tx))
      .sort((a, b) => (fulfilledDate(b)?.getTime() ?? 0) - (fulfilledDate(a)?.getTime() ?? 0))
      .slice(0, 3);
    const typicalVolume =
      recent.length > 0 ?
        Math.round(recent.reduce((sum, tx) => sum + countUnits(tx), 0) / recent.length) :
        null;
    const revenueAmounts = recent
      .map((tx) => Number(tx.totalAmount) || 0)
      .filter((amount) => amount > 0);
    const estimatedRevenueAtRisk =
      revenueAmounts.length > 0 ?
        Math.round(
          revenueAmounts.reduce((sum, amount) => sum + amount, 0) / revenueAmounts.length,
        ) :
        null;

    rows.push({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      daysSinceLastOrder: daysSince,
      lastFulfilledAt: lastDate,
      lastOrderType: lastType,
      historicalOrderCount,
      avgCadenceDays,
      unpaidBalance: unpaidByCustomer.get(customer.id) || 0,
      typicalVolume,
      tier: dormantTier(daysSince),
      cadenceLate,
      estimatedRevenueAtRisk,
    });
  }

  return rows.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);
}

export function buildDormantSignalsSnapshot(
  customers: Customer[],
  transactions: Transaction[],
  now = new Date(),
): Record<string, unknown> {
  const rows = buildDormantCustomerRows(customers, transactions, { now });
  const byTier = { watch: 0, at_risk: 0, churned: 0 };
  for (const row of rows) {
    byTier[row.tier] += 1;
  }

  const fourteenAgo = new Date(now.getTime() - 14 * 86_400_000);
  const priorRows = buildDormantCustomerRows(customers, transactions, {
    thresholdDays: 7,
    now: fourteenAgo,
  });

  const revenueAtRisk = rows.reduce(
    (sum, row) => sum + (row.estimatedRevenueAtRisk ?? 0),
    0,
  );

  return {
    thresholdDays: DEFAULT_DORMANT_THRESHOLD_DAYS,
    dormantCount: rows.length,
    byTier,
    cadenceLateCount: rows.filter((row) => row.cadenceLate).length,
    revenueAtRiskPhp: Math.round(revenueAtRisk * 100) / 100,
    vsPriorPeriodDormantCount: priorRows.length,
    sample: rows.slice(0, 15).map((row) => ({
      name: row.name,
      daysSilent: row.daysSinceLastOrder,
      avgCadenceDays: row.avgCadenceDays,
      cadenceLate: row.cadenceLate,
      lastVolumeUnits: row.typicalVolume,
      estimatedRevenueAtRiskPhp: row.estimatedRevenueAtRisk,
      unpaidBalancePhp: Math.round(row.unpaidBalance * 100) / 100,
      historicalOrders: row.historicalOrderCount,
      tier: row.tier,
    })),
  };
}
