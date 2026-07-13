import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";

type SukiHealthWeights = {
  recency: number;
  frequency: number;
  payment: number;
  rating: number;
  ops: number;
};

const DEFAULT_WEIGHTS: SukiHealthWeights = {
  recency: 0.35,
  frequency: 0.25,
  payment: 0.2,
  rating: 0.1,
  ops: 0.1,
};

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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / msPerDay,
  );
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

function fulfilledDate(tx: Transaction): Date | null {
  if (!isFulfilled(tx)) return null;
  return (
    parseTxDate((tx as { deliveredAt?: unknown }).deliveredAt) ||
    parseTxDate(tx.updatedAt) ||
    parseTxDate(tx.createdAt)
  );
}

function normalizeStarRating(raw: unknown): number | undefined {
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v) || v < 1 || v > 5) return undefined;
  return v;
}

function effectiveServiceRating(tx: Transaction): number | undefined {
  return (
    normalizeStarRating(tx.serviceRating) ??
    normalizeStarRating(tx.rating) ??
    normalizeStarRating(tx.riderRating)
  );
}

function recencyPoints(daysSince: number | null): number {
  if (daysSince == null) return 0;
  if (daysSince <= 7) return 100;
  if (daysSince <= 14) return 75;
  if (daysSince <= 30) return 50;
  if (daysSince <= 60) return 25;
  return 10;
}

function frequencyPoints(orderCount90d: number): number {
  if (orderCount90d >= 6) return 100;
  if (orderCount90d >= 3) return 75;
  if (orderCount90d >= 1) return 50;
  return 0;
}

function paymentPoints(unpaidBalance: number): number {
  if (unpaidBalance <= 0) return 100;
  const penalty = Math.min(100, Math.round((unpaidBalance / 1000) * 100));
  return Math.max(0, 100 - penalty);
}

function ratingPoints(avgRating: number | null): number {
  if (avgRating == null) return 70;
  return Math.round((avgRating / 5) * 100);
}

function customerHasOpenPipeline(customerId: string, transactions: Transaction[]): boolean {
  const terminal = new Set(["delivered", "completed", "cancelled", "failed", "collected"]);
  for (const tx of transactions) {
    if (tx.customerId !== customerId) continue;
    if (tx.type === "delivery") {
      const status = tx.deliveryStatus;
      if (status && !terminal.has(status)) return true;
    }
    if (tx.type !== "expense" && tx.type !== "collection") {
      const bal = Number(tx.balanceDue) || 0;
      if (bal > 0.009 && !isFulfilled(tx)) return true;
    }
  }
  return false;
}

export function computeSukiHealthScore(
  customer: Customer,
  customerTxs: Transaction[],
  allTransactions: Transaction[],
  now: Date,
  weights: SukiHealthWeights = DEFAULT_WEIGHTS,
): number {
  if (!customer.id) return 0;

  let lastDate =
    parseTxDate(customer.lastFulfilledAt) || parseTxDate(customer.lastOrderAt);
  for (const tx of customerTxs) {
    const d = fulfilledDate(tx);
    if (d && (!lastDate || d > lastDate)) lastDate = d;
  }
  const daysSince =
    lastDate != null ? differenceInCalendarDays(now, lastDate) : null;

  const periodStart = new Date(now.getTime() - 90 * 86_400_000);
  let orderCount90d = 0;
  for (const tx of customerTxs) {
    if (!isFulfilled(tx) || tx.type === "expense") continue;
    const anchor = fulfilledDate(tx);
    if (!anchor || anchor < periodStart || anchor > now) continue;
    orderCount90d += 1;
  }

  let unpaidBalance = 0;
  for (const tx of allTransactions) {
    if (tx.customerId !== customer.id || !isFulfilled(tx)) continue;
    if (tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial") {
      unpaidBalance += Number(tx.balanceDue) || 0;
    }
  }

  const ratings: number[] = [];
  for (const tx of customerTxs) {
    const stars = effectiveServiceRating(tx);
    if (stars != null) ratings.push(stars);
  }
  const avgRating =
    ratings.length > 0 ?
      ratings.reduce((sum, r) => sum + r, 0) / ratings.length :
      null;

  const opsPts = customerHasOpenPipeline(customer.id, allTransactions) ? 0 : 100;

  const recencyPts = recencyPoints(daysSince);
  const frequencyPts = frequencyPoints(orderCount90d);
  const paymentPts = paymentPoints(unpaidBalance);
  const ratingPts = ratingPoints(avgRating);

  const score = Math.round(
    recencyPts * weights.recency +
      frequencyPts * weights.frequency +
      paymentPts * weights.payment +
      ratingPts * weights.rating +
      opsPts * weights.ops,
  );

  return Math.max(0, Math.min(100, score));
}

export type LowHealthSampleRow = {
  name: string;
  score: number;
  unpaidBalancePhp: number;
};

/**
 * Lowest suki health scores for morning brief context (max 8 active customers).
 * @param {Customer[]} customers Active customers in the workspace.
 * @param {Transaction[]} transactions Ledger rows used for scoring and unpaid balances.
 * @param {Date} [now] Reference date for recency scoring.
 * @param {number} [limit] Max rows to return (default 8).
 * @return {LowHealthSampleRow[]} Lowest-scoring customers with unpaid balance context.
 */
export function buildLowHealthSample(
  customers: Customer[],
  transactions: Transaction[],
  now = new Date(),
  limit = 8,
): LowHealthSampleRow[] {
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
    if (tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial") {
      unpaidByCustomer.set(
        tx.customerId,
        (unpaidByCustomer.get(tx.customerId) || 0) + (Number(tx.balanceDue) || 0),
      );
    }
  }

  const scored: Array<{ name: string; score: number; unpaidBalancePhp: number }> = [];

  for (const customer of customers) {
    if (!customer.id || customer.status === "inactive") continue;
    const custTxs = txsByCustomer.get(customer.id) || [];
    if (custTxs.length === 0 && !customer.lastFulfilledAt && !customer.lastOrderAt) {
      continue;
    }
    const score = computeSukiHealthScore(
      customer,
      custTxs,
      transactions,
      now,
    );
    scored.push({
      name: customer.name,
      score,
      unpaidBalancePhp:
        Math.round((unpaidByCustomer.get(customer.id) || 0) * 100) / 100,
    });
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((row) => ({
      name: row.name,
      score: row.score,
      unpaidBalancePhp: row.unpaidBalancePhp,
    }));
}
