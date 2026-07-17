import { coerceToDate, manilaDateKey } from "./philippine-datetime";
import type { Transaction } from "../services/transactions/transaction-service";
import { isActivePayment } from "../services/transactions/payment-status";

const NON_REVENUE_TYPES = new Set<Transaction["type"]>(["expense", "collection"]);
const ONLINE_METHODS = new Set(["digital_wallet", "bank_transfer", "other"]);

export type CollectedRevenueBreakdown = {
  cashPhp: number;
  onlinePhp: number;
};

export type WorkspaceRevenueMetrics = {
  todayPhp: number;
  yesterdayPhp: number;
  last7DaysPhp: number;
  prior7DaysPhp: number;
  expensesTodayPhp: number;
  netTodayPhp: number;
  todayBreakdown: CollectedRevenueBreakdown;
  dailyAvgLast7DaysPhp: number;
  forecastNext7DaysPhp: number;
  trendVsPriorWeekPct: number | null;
};

function roundPhp(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function paymentDayKey(raw: unknown): string | null {
  const d = coerceToDate(raw);
  return d ? manilaDateKey(d) : null;
}

function isCashMethod(method: string | undefined): boolean {
  return !method || method === "cash";
}

function addPaymentSlice(
  buckets: { revenue: number; expenses: number; cash: number; online: number },
  amount: number,
  method: string | undefined,
  kind: "revenue" | "expense",
): void {
  if (amount <= 0) return;
  if (kind === "revenue") {
    buckets.revenue += amount;
    if (isCashMethod(method)) buckets.cash += amount;
    else buckets.online += amount;
    return;
  }
  buckets.expenses += amount;
}

function sumCollectedBetweenDayKeys(
  transactions: Transaction[],
  testDayKey: (dayKey: string) => boolean,
): { revenue: number; expenses: number; cash: number; online: number } {
  const buckets = { revenue: 0, expenses: 0, cash: 0, online: 0 };

  for (const tx of transactions) {
    const payments = tx.payments || [];

    if (payments.length > 0) {
      for (const payment of payments) {
        if (!isActivePayment(payment)) continue;
        const amount = Number(payment.amount) || 0;
        if (amount <= 0) continue;
        const dayKey = paymentDayKey(payment.date);
        if (!dayKey || !testDayKey(dayKey)) continue;

        if (tx.type === "expense") {
          addPaymentSlice(buckets, amount, payment.method, "expense");
          continue;
        }
        if (NON_REVENUE_TYPES.has(tx.type)) continue;
        addPaymentSlice(buckets, amount, payment.method, "revenue");
      }
      continue;
    }

    const amountPaid = Number(tx.amountPaid) || 0;
    if (amountPaid <= 0) continue;

    const fallbackDayKey = paymentDayKey(tx.scheduledAt ?? tx.createdAt);
    if (!fallbackDayKey || !testDayKey(fallbackDayKey)) continue;

    if (tx.type === "expense") {
      addPaymentSlice(buckets, amountPaid, tx.paymentMethod, "expense");
      continue;
    }
    if (NON_REVENUE_TYPES.has(tx.type)) continue;

    const method = tx.paymentMethod;
    const normalizedOnline =
      method && ONLINE_METHODS.has(method) ? method : "cash";
    addPaymentSlice(
      buckets,
      amountPaid,
      normalizedOnline === "cash" ? "cash" : method,
      "revenue",
    );
  }

  return buckets;
}

function offsetManilaDateKey(dayKey: string, offsetDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return utc.toISOString().slice(0, 10);
}

/** Payment-date revenue metrics aligned with the dashboard / ledger "collected today" logic. */
export function buildWorkspaceRevenueMetrics(
  transactions: Transaction[],
  now = new Date(),
): WorkspaceRevenueMetrics {
  const todayKey = manilaDateKey(now);
  const yesterdayKey = offsetManilaDateKey(todayKey, -1);

  const last7DayKeys = Array.from({ length: 7 }, (_, i) =>
    offsetManilaDateKey(todayKey, -i),
  );
  const prior7DayKeys = Array.from({ length: 7 }, (_, i) =>
    offsetManilaDateKey(todayKey, -(i + 7)),
  );

  const todayBuckets = sumCollectedBetweenDayKeys(transactions, (key) => key === todayKey);
  const yesterdayBuckets = sumCollectedBetweenDayKeys(
    transactions,
    (key) => key === yesterdayKey,
  );
  const last7Buckets = sumCollectedBetweenDayKeys(transactions, (key) =>
    last7DayKeys.includes(key),
  );
  const prior7Buckets = sumCollectedBetweenDayKeys(transactions, (key) =>
    prior7DayKeys.includes(key),
  );

  const dailyAvgLast7DaysPhp = roundPhp(last7Buckets.revenue / 7);
  const forecastNext7DaysPhp = roundPhp(dailyAvgLast7DaysPhp * 7);
  const trendVsPriorWeekPct =
    prior7Buckets.revenue > 0 ?
      roundPhp(
        ((last7Buckets.revenue - prior7Buckets.revenue) / prior7Buckets.revenue) *
          100,
      ) :
      null;

  return {
    todayPhp: roundPhp(todayBuckets.revenue),
    yesterdayPhp: roundPhp(yesterdayBuckets.revenue),
    last7DaysPhp: roundPhp(last7Buckets.revenue),
    prior7DaysPhp: roundPhp(prior7Buckets.revenue),
    expensesTodayPhp: roundPhp(todayBuckets.expenses),
    netTodayPhp: roundPhp(todayBuckets.revenue - todayBuckets.expenses),
    todayBreakdown: {
      cashPhp: roundPhp(todayBuckets.cash),
      onlinePhp: roundPhp(todayBuckets.online),
    },
    dailyAvgLast7DaysPhp,
    forecastNext7DaysPhp,
    trendVsPriorWeekPct,
  };
}
