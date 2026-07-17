import type { DormantCustomerRow } from "../utils/dormant-customers";
import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";
import { isActivePayment } from "../services/transactions/payment-status";
import { isTransactionFulfilledForReceivable, isUnpaidReceivableTransaction } from "./unpaid-receivable";

export type DebtAgingBucketId = "current" | "days_31_60" | "days_61_90" | "over_90";

export type DebtAgingBucket = {
  id: DebtAgingBucketId;
  label: string;
  customerCount: number;
  totalAmount: number;
};

export type DebtAgingCustomerRow = {
  customerId: string;
  name: string;
  amount: number;
  transactionCount: number;
  oldestDebtDays: number;
  bucketId: DebtAgingBucketId;
  bucketLabel: string;
};

export type DebtAgingBreakdown = {
  buckets: DebtAgingBucket[];
  rows: DebtAgingCustomerRow[];
  oldestDebtDays: number | null;
  summaryLabel: string;
};

const BUCKET_DEFS: {
  id: DebtAgingBucketId;
  label: string;
}[] = [
  { id: "current", label: "0–30 days" },
  { id: "days_31_60", label: "31–60 days" },
  { id: "days_61_90", label: "61–90 days" },
  { id: "over_90", label: "90+ days" },
];

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isWithinRange(day: Date, start: Date, end: Date): boolean {
  const t = startOfDay(day).getTime();
  return t >= startOfDay(start).getTime() && t <= endOfDay(end).getTime();
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / msPerDay);
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

function bucketForDays(days: number): DebtAgingBucketId {
  if (days <= 30) return "current";
  if (days <= 60) return "days_31_60";
  if (days <= 90) return "days_61_90";
  return "over_90";
}

function bucketLabel(id: DebtAgingBucketId): string {
  return BUCKET_DEFS.find((b) => b.id === id)?.label ?? id;
}

export function computeDebtAgingBreakdown(
  transactions: Transaction[],
  customers: Customer[],
  now = new Date(),
): DebtAgingBreakdown {
  const today = startOfDay(now);
  const customerById = new Map(
    customers
      .filter((c): c is Customer & { id: string } => Boolean(c.id))
      .map((c) => [c.id, c]),
  );

  const byCustomer = new Map<
    string,
    { amount: number; transactionCount: number; oldest: Date | null }
  >();

  for (const tx of transactions) {
    if (!tx.customerId) continue;
    if (!isUnpaidReceivableTransaction(tx)) continue;

    const cur = byCustomer.get(tx.customerId) || {
      amount: 0,
      transactionCount: 0,
      oldest: null,
    };
    const anchor =
      parseTxDate(tx.scheduledAt) || parseTxDate(tx.createdAt) || today;
    cur.amount += Number(tx.balanceDue) || 0;
    cur.transactionCount += 1;
    if (!cur.oldest || anchor < cur.oldest) cur.oldest = anchor;
    byCustomer.set(tx.customerId, cur);
  }

  const rows: DebtAgingCustomerRow[] = [];
  const bucketTotals = new Map<DebtAgingBucketId, { customerCount: number; totalAmount: number }>();
  for (const def of BUCKET_DEFS) {
    bucketTotals.set(def.id, { customerCount: 0, totalAmount: 0 });
  }

  let oldestDebtDays: number | null = null;

  for (const [customerId, agg] of byCustomer) {
    if (!agg.oldest) continue;
    const days = differenceInCalendarDays(today, startOfDay(agg.oldest));
    const bucketId = bucketForDays(days);
    if (oldestDebtDays == null || days > oldestDebtDays) oldestDebtDays = days;

    const bucket = bucketTotals.get(bucketId);
    if (!bucket) continue;
    bucket.customerCount += 1;
    bucket.totalAmount += agg.amount;

    rows.push({
      customerId,
      name: customerById.get(customerId)?.name || "Customer",
      amount: agg.amount,
      transactionCount: agg.transactionCount,
      oldestDebtDays: days,
      bucketId,
      bucketLabel: bucketLabel(bucketId),
    });
  }

  rows.sort((a, b) => b.oldestDebtDays - a.oldestDebtDays || b.amount - a.amount);

  const buckets: DebtAgingBucket[] = BUCKET_DEFS.map((def) => {
    const t = bucketTotals.get(def.id) ?? { customerCount: 0, totalAmount: 0 };
    return {
      id: def.id,
      label: def.label,
      customerCount: t.customerCount,
      totalAmount: t.totalAmount,
    };
  });

  let summaryLabel = "All clear";
  if (rows.length > 0) {
    const over90 = buckets.find((b) => b.id === "over_90");
    const days61 = buckets.find((b) => b.id === "days_61_90");
    if (over90 && over90.customerCount > 0) {
      summaryLabel = `${over90.customerCount} over 90d`;
    } else if (days61 && days61.customerCount > 0) {
      summaryLabel = `Oldest ${oldestDebtDays}d`;
    } else if (oldestDebtDays != null) {
      summaryLabel = `Oldest ${oldestDebtDays}d`;
    }
  }

  return { buckets, rows, oldestDebtDays, summaryLabel };
}

export type CohortStatsResponse = {
  newCount: number;
  returningCount: number;
  totalActive: number;
  periodDays: number;
};

function isFulfilledOrder(tx: Transaction): boolean {
  if (tx.type === "expense" || tx.type === "collection") return false;
  return isTransactionFulfilledForReceivable(tx);
}

function orderDate(tx: Transaction): Date {
  return parseTxDate(tx.scheduledAt) || parseTxDate(tx.createdAt) || new Date();
}

export function computeCohortStats(
  transactions: Transaction[],
  periodDays = 30,
  now = new Date(),
): CohortStatsResponse {
  const end = startOfDay(now);
  const start = new Date(end);
  start.setDate(start.getDate() - periodDays);

  const firstOrderByCustomer = new Map<string, Date>();
  for (const tx of transactions) {
    if (!tx.customerId || !isFulfilledOrder(tx)) continue;
    const d = orderDate(tx);
    const cur = firstOrderByCustomer.get(tx.customerId);
    if (!cur || d < cur) firstOrderByCustomer.set(tx.customerId, d);
  }

  const activeInRange = new Set<string>();
  for (const tx of transactions) {
    if (!tx.customerId || !isFulfilledOrder(tx)) continue;
    const d = orderDate(tx);
    if (d >= start && d <= end) activeInRange.add(tx.customerId);
  }

  let newCount = 0;
  let returningCount = 0;
  for (const customerId of activeInRange) {
    const first = firstOrderByCustomer.get(customerId);
    if (!first) continue;
    if (first >= start && first <= end) newCount += 1;
    else if (first < start) returningCount += 1;
  }

  return {
    newCount,
    returningCount,
    totalActive: activeInRange.size,
    periodDays,
  };
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  limit: number,
): { data: T[]; meta: { totalCount: number; page: number; limit: number; totalPages: number } } {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const safePage = Math.max(1, page);
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  const start = (safePage - 1) * safeLimit;
  const data = rows.slice(start, start + safeLimit);
  return {
    data,
    meta: { totalCount, page: safePage, limit: safeLimit, totalPages },
  };
}

const NON_REVENUE_TYPES = new Set<Transaction["type"]>(["expense", "collection"]);

function forEachRevenuePaymentInRange(
  transactions: Transaction[],
  start: Date,
  end: Date,
  onPayment: (amount: number) => void,
): void {
  for (const tx of transactions) {
    if (NON_REVENUE_TYPES.has(tx.type)) continue;

    const payments = tx.payments || [];
    if (payments.length > 0) {
      for (const payment of payments) {
        if (!isActivePayment(payment)) continue;
        const amount = Number(payment.amount) || 0;
        if (amount <= 0) continue;
        const paidOn = parseTxDate(payment.date);
        if (!paidOn || !isWithinRange(paidOn, start, end)) continue;
        onPayment(amount);
      }
      continue;
    }

    const amountPaid = Number(tx.amountPaid) || 0;
    if (amountPaid <= 0) continue;
    const txDay = parseTxDate(tx.scheduledAt) || parseTxDate(tx.createdAt);
    if (!txDay || !isWithinRange(txDay, start, end)) continue;
    onPayment(amountPaid);
  }
}

export function sumRevenuePaymentsInRange(
  transactions: Transaction[],
  start: Date,
  end: Date,
): number {
  let sum = 0;
  forEachRevenuePaymentInRange(transactions, start, end, (amount) => {
    sum += amount;
  });
  return sum;
}

export function sumRevenue30d(transactions: Transaction[], now = new Date()): number {
  const end = endOfDay(now);
  const start = startOfDay(now);
  start.setDate(start.getDate() - 29);
  return sumRevenuePaymentsInRange(transactions, start, end);
}

/** Last 7 days vs prior 7 days, by payment date. */
export function computeRevenueWowPct(transactions: Transaction[], now = new Date()): number | null {
  const end = endOfDay(now);
  const thisStart = startOfDay(now);
  thisStart.setDate(thisStart.getDate() - 6);
  const priorEnd = endOfDay(new Date(thisStart));
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = startOfDay(priorEnd);
  priorStart.setDate(priorStart.getDate() - 6);

  const current = sumRevenuePaymentsInRange(transactions, thisStart, end);
  const prior = sumRevenuePaymentsInRange(transactions, priorStart, priorEnd);
  if (prior <= 0) {
    return current > 0 ? 100 : null;
  }
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export type RevenueTrendPoint = {
  dayKey: string;
  label: string;
  amount: number;
};

export type RevenueTrendSummary = {
  points: RevenueTrendPoint[];
  today: number;
  avg7: number;
  vsAvgLabel: string;
};

/** BL-49 — daily revenue sparkline by payment date (Manila calendar days). */
export function computeRevenueTrend(
  transactions: Transaction[],
  trendDays = 14,
  now = new Date(),
): RevenueTrendSummary {
  const anchor = startOfDay(now);
  const points: RevenueTrendPoint[] = [];

  for (let i = trendDays - 1; i >= 0; i--) {
    const day = new Date(anchor);
    day.setDate(day.getDate() - i);
    const dayEnd = endOfDay(day);
    const amount = Math.round(sumRevenuePaymentsInRange(transactions, day, dayEnd));
    points.push({
      dayKey: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString("en-PH", { weekday: "short" }).slice(0, 2),
      amount,
    });
  }

  const today = points[points.length - 1]?.amount ?? 0;
  const last7 = points.slice(-7);
  const avg7 =
    last7.length > 0 ? last7.reduce((s, p) => s + p.amount, 0) / last7.length : 0;
  const diff = avg7 > 0 ? Math.round(((today - avg7) / avg7) * 100) : null;
  const vsAvgLabel =
    diff == null ?
      "No 7-day baseline yet" :
      diff >= 0 ?
        `${diff}% above 7-day avg` :
        `${Math.abs(diff)}% below 7-day avg`;

  return { points, today, avg7, vsAvgLabel };
}

export type { DormantCustomerRow };
