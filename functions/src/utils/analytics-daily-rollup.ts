/**
 * Pure helpers to bucket ledger rows into Asia/Manila daily analytics rollups.
 */
import { coerceToDate, manilaDateKey } from "./philippine-datetime";
import { isTransactionFulfilledForReceivable } from "./unpaid-receivable";
import type { Transaction } from "../services/transactions/transaction-service";
import { isActivePayment } from "../services/transactions/payment-status";

const NON_REVENUE_TYPES = new Set<Transaction["type"]>(["expense", "collection"]);
const ONLINE_METHODS = new Set(["digital_wallet", "bank_transfer", "other"]);

export const ANALYTICS_SNAPSHOT_VERSION = 1;
export const ANALYTICS_DAILY_VERSION = 1;
/** Nightly rebuild window (Asia/Manila calendar days). */
export const ANALYTICS_RECONCILE_DAY_COUNT = 400;
/** Ledger page size when materializing stock + daily docs. */
export const ANALYTICS_MATERIALIZE_TX_LIMIT = 8000;

export type AnalyticsDailyRollup = {
  dateKey: string;
  revenueTotal: number;
  revenueCash: number;
  revenueOnline: number;
  expensesTotal: number;
  fulfilledCount: number;
  paymentCount: number;
};

function roundPhp(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function isCashMethod(method: string | undefined): boolean {
  return !method || method === "cash";
}

function emptyDay(dateKey: string): AnalyticsDailyRollup {
  return {
    dateKey,
    revenueTotal: 0,
    revenueCash: 0,
    revenueOnline: 0,
    expensesTotal: 0,
    fulfilledCount: 0,
    paymentCount: 0,
  };
}

function ensureDay(
  map: Map<string, AnalyticsDailyRollup>,
  dateKey: string,
): AnalyticsDailyRollup {
  let day = map.get(dateKey);
  if (!day) {
    day = emptyDay(dateKey);
    map.set(dateKey, day);
  }
  return day;
}

function addRevenue(
  day: AnalyticsDailyRollup,
  amount: number,
  method: string | undefined,
): void {
  if (amount <= 0) return;
  day.revenueTotal = roundPhp(day.revenueTotal + amount);
  day.paymentCount += 1;
  if (isCashMethod(method)) {
    day.revenueCash = roundPhp(day.revenueCash + amount);
  } else {
    day.revenueOnline = roundPhp(day.revenueOnline + amount);
  }
}

function addExpense(day: AnalyticsDailyRollup, amount: number): void {
  if (amount <= 0) return;
  day.expensesTotal = roundPhp(day.expensesTotal + amount);
  day.paymentCount += 1;
}

/**
 * Builds per-day payment-date rollups from a transaction ledger sample.
 * @param {Transaction[]} transactions Ledger rows (newest-first OK).
 * @param {ReadonlySet<string> | null} onlyDateKeys When set, only accumulate those days.
 * @return {Map<string, AnalyticsDailyRollup>} Manila dateKey → rollup.
 */
export function buildAnalyticsDailyRollups(
  transactions: Transaction[],
  onlyDateKeys: ReadonlySet<string> | null = null,
): Map<string, AnalyticsDailyRollup> {
  const map = new Map<string, AnalyticsDailyRollup>();

  for (const tx of transactions) {
    if (isTransactionFulfilledForReceivable(tx)) {
      const fulfilledKey = manilaDateKey(
        coerceToDate(tx.scheduledAt) ?? coerceToDate(tx.createdAt) ?? new Date(),
      );
      if (!onlyDateKeys || onlyDateKeys.has(fulfilledKey)) {
        ensureDay(map, fulfilledKey).fulfilledCount += 1;
      }
    }

    const payments = tx.payments || [];
    if (payments.length > 0) {
      for (const payment of payments) {
        if (!isActivePayment(payment)) continue;
        const amount = Number(payment.amount) || 0;
        if (amount <= 0) continue;
        const dayKey = coerceToDate(payment.date) ?
          manilaDateKey(coerceToDate(payment.date) as Date) :
          null;
        if (!dayKey) continue;
        if (onlyDateKeys && !onlyDateKeys.has(dayKey)) continue;
        const day = ensureDay(map, dayKey);
        if (tx.type === "expense") {
          addExpense(day, amount);
          continue;
        }
        if (NON_REVENUE_TYPES.has(tx.type)) continue;
        addRevenue(day, amount, payment.method);
      }
      continue;
    }

    const amountPaid = Number(tx.amountPaid) || 0;
    if (amountPaid <= 0) continue;
    const fallback =
      coerceToDate(tx.scheduledAt) ?? coerceToDate(tx.createdAt);
    if (!fallback) continue;
    const dayKey = manilaDateKey(fallback);
    if (onlyDateKeys && !onlyDateKeys.has(dayKey)) continue;
    const day = ensureDay(map, dayKey);

    if (tx.type === "expense") {
      addExpense(day, amountPaid);
      continue;
    }
    if (NON_REVENUE_TYPES.has(tx.type)) continue;

    const method = tx.paymentMethod;
    const normalized =
      method && ONLINE_METHODS.has(method) ? method : "cash";
    addRevenue(day, amountPaid, normalized === "cash" ? "cash" : method);
  }

  return map;
}

/**
 * Inclusive sum of daily rollups for [fromKey, toKey] (yyyy-MM-dd).
 * @param {Iterable<AnalyticsDailyRollup>} days Rollup docs.
 * @param {string} fromKey Inclusive start.
 * @param {string} toKey Inclusive end.
 * @return {Object} Aggregated money + day coverage.
 */
export function sumAnalyticsDailyRange(
  days: Iterable<AnalyticsDailyRollup>,
  fromKey: string,
  toKey: string,
): {
  from: string;
  to: string;
  dayCount: number;
  revenueTotal: number;
  revenueCash: number;
  revenueOnline: number;
  expensesTotal: number;
  fulfilledCount: number;
  netTotal: number;
} {
  let dayCount = 0;
  let revenueTotal = 0;
  let revenueCash = 0;
  let revenueOnline = 0;
  let expensesTotal = 0;
  let fulfilledCount = 0;

  for (const day of days) {
    if (day.dateKey < fromKey || day.dateKey > toKey) continue;
    dayCount += 1;
    revenueTotal += day.revenueTotal;
    revenueCash += day.revenueCash;
    revenueOnline += day.revenueOnline;
    expensesTotal += day.expensesTotal;
    fulfilledCount += day.fulfilledCount;
  }

  return {
    from: fromKey,
    to: toKey,
    dayCount,
    revenueTotal: roundPhp(revenueTotal),
    revenueCash: roundPhp(revenueCash),
    revenueOnline: roundPhp(revenueOnline),
    expensesTotal: roundPhp(expensesTotal),
    fulfilledCount,
    netTotal: roundPhp(revenueTotal - expensesTotal),
  };
}

/**
 * Walks Manila calendar days backward from `anchor`.
 * @param {number} dayCount Inclusive day count.
 * @param {Date} anchor Instant.
 * @return {{ fromKey: string, toKey: string }} Inclusive range keys.
 */
export function manilaDayRangeKeys(
  dayCount: number,
  anchor = new Date(),
): { fromKey: string; toKey: string } {
  const toKey = manilaDateKey(anchor);
  const cursor = new Date(`${toKey}T12:00:00+08:00`);
  cursor.setUTCDate(cursor.getUTCDate() - (Math.max(1, dayCount) - 1));
  return { fromKey: manilaDateKey(cursor), toKey };
}

/**
 * Recent incremental date keys (today + prior N Manila days).
 * @param {number} lookbackDays Extra days before today.
 * @param {Date} now Instant.
 * @return {string[]} Unique yyyy-MM-dd keys.
 */
export function incrementalMaterializeDateKeys(
  lookbackDays = 2,
  now = new Date(),
): string[] {
  const toKey = manilaDateKey(now);
  const keys: string[] = [];
  for (let i = 0; i <= lookbackDays; i++) {
    const cursor = new Date(`${toKey}T12:00:00+08:00`);
    cursor.setUTCDate(cursor.getUTCDate() - i);
    keys.push(manilaDateKey(cursor));
  }
  return keys;
}
