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

/** Fulfilled income with outstanding balance (partial or unpaid). */
export function isUnpaidReceivableTransaction(tx: Transaction): boolean {
  if (tx.type === "expense" || tx.type === "collection") return false;
  if (!isTransactionFulfilledForReceivable(tx)) return false;
  const unpaid =
    tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial";
  return unpaid && (Number(tx.balanceDue) || 0) > 0;
}
