import type { DormantCustomerRow } from "../utils/dormant-customers";
import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";

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
    const unpaid = tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial";
    if (!isFulfilled(tx) || !unpaid || (Number(tx.balanceDue) || 0) <= 0) continue;

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
  if (tx.type === "walkin" || tx.type === "direct_sale") return true;
  if (tx.type === "delivery") {
    const s = tx.deliveryStatus;
    if (!s) return false;
    return ["delivered", "completed", "collected"].includes(s);
  }
  return false;
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

export type { DormantCustomerRow };
