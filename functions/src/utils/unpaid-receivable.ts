import { getActiveAmountPaid } from "../services/transactions/payment-status";
import type { Transaction } from "../services/transactions/transaction-service";

const FULFILLED_DELIVERY_STATUSES = new Set([
  "delivered",
  "completed",
  "collected",
]);

const OPEN_DELIVERY_STATUSES = new Set([
  "pending",
  "placed",
  "in-transit",
]);

/** Normalize Firestore / legacy delivery status strings for comparisons. */
export function normalizeDeliveryStatus(status: unknown): string {
  if (typeof status !== "string") return "";
  return status.trim().toLowerCase();
}

/**
 * True when the order is finalized (receivable can exist).
 * Pending / placed / in-transit deliveries are still on-going — not unpaid debt yet.
 */
export function isTransactionFulfilledForReceivable(tx: Transaction): boolean {
  if (tx.type === "walkin" || tx.type === "direct_sale") return true;
  if (tx.type === "expense") return false;

  const ds = normalizeDeliveryStatus(tx.deliveryStatus);

  if (tx.type === "collection") {
    if (!ds) return true;
    return FULFILLED_DELIVERY_STATUSES.has(ds);
  }

  if (tx.type === "delivery") {
    if (!ds || OPEN_DELIVERY_STATUSES.has(ds)) return false;
    return FULFILLED_DELIVERY_STATUSES.has(ds);
  }

  return false;
}

/**
 * Outstanding pesos on one order.
 * Collected cash wins over a stored balanceDue. A zero or missing balanceDue
 * must not hide a billed total that was never collected. A legacy partial that
 * only wrote balanceDue (no amountPaid) still uses that stored remainder.
 */
export function outstandingBalanceDue(tx: Transaction): number {
  const activePaid = getActiveAmountPaid(tx);
  const total = Number(tx.totalAmount);
  const derived = Number.isFinite(total) ? Math.max(0, total - activePaid) : null;
  const storedRaw = Number(tx.balanceDue);
  const stored = Number.isFinite(storedRaw) ? Math.max(0, storedRaw) : null;

  if (activePaid > 0.009 && derived != null) return derived;
  if (stored != null && stored > 0.009) return stored;
  if (tx.paymentStatus === "paid") return 0;
  if (derived != null) return derived;
  return stored ?? 0;
}

/** Fulfilled income that still has pesos to collect. */
export function isUnpaidReceivableTransaction(tx: Transaction): boolean {
  if (tx.type === "expense" || tx.type === "collection") return false;
  if (!isTransactionFulfilledForReceivable(tx)) return false;
  if (tx.paymentStatus === "N/A") return false;
  return outstandingBalanceDue(tx) > 0.009;
}
