import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";

export type LowRatingSampleRow = {
  name: string;
  rating: number;
  feedback?: string;
  referenceId?: string;
  at: string;
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

function normalizeStarRating(raw: unknown): number | undefined {
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v) || v < 1 || v > 5) return undefined;
  return v;
}

function effectiveServiceRating(tx: Transaction): number | undefined {
  const service = normalizeStarRating(tx.serviceRating ?? tx.rating);
  if (tx.type === "walkin") {
    const wrs = normalizeStarRating(tx.wrsRating);
    const values = [service, wrs].filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }
  return service;
}

/**
 * AI-07 — sukis with low service ratings in the lookback window (one row per customer).
 */
export function buildLowRatingSample(
  customers: Customer[],
  transactions: Transaction[],
  now = new Date(),
  maxRating = 3,
  lookbackDays = 90,
  limit = 10,
): LowRatingSampleRow[] {
  const rangeStart = new Date(now.getTime() - lookbackDays * 86400000);
  const nameById = new Map(
    customers.filter((c) => c.id).map((c) => [c.id!, c.name]),
  );
  const byCustomer = new Map<string, LowRatingSampleRow>();

  for (const tx of transactions) {
    const rating = effectiveServiceRating(tx);
    if (rating == null || rating > maxRating) continue;
    const at =
      parseTxDate(tx.updatedAt) ??
      parseTxDate(tx.createdAt);
    if (!at || at < rangeStart || at > now) continue;
    const customerId = tx.customerId;
    if (!customerId) continue;

    const row: LowRatingSampleRow = {
      name: tx.customerName || nameById.get(customerId) || "Customer",
      rating,
      feedback: typeof tx.feedback === "string" ? tx.feedback.trim().slice(0, 200) : undefined,
      referenceId: tx.referenceId,
      at: at.toISOString(),
    };

    const existing = byCustomer.get(customerId);
    if (existing) {
      if (existing.rating < row.rating) continue;
      if (existing.rating === row.rating && existing.at >= row.at) continue;
    }
    byCustomer.set(customerId, row);
  }

  return [...byCustomer.values()]
    .sort((a, b) => a.rating - b.rating || b.at.localeCompare(a.at))
    .slice(0, limit);
}

export function lowRatingSampleNameKeys(
  snapshot: Record<string, unknown>,
): Set<string> {
  const sample = snapshot.lowRatingSample;
  if (!Array.isArray(sample)) return new Set();
  const keys = new Set<string>();
  for (const row of sample) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as { name?: string }).name || "").trim().toLowerCase();
    if (name) keys.add(name);
  }
  return keys;
}
