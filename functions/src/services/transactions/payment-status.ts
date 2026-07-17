import type { Transaction, TransactionPayment } from "./transaction-types";

export type LedgerPaymentStatus = Transaction["paymentStatus"];

/** Active (non-voided) payment row. */
export function isActivePayment(
  payment: Pick<TransactionPayment, "voided"> | null | undefined,
): boolean {
  return !payment?.voided;
}

/**
 * Sum of non-voided payment rows; falls back to `amountPaid` when payments[] is absent.
 * Matches FE `getActiveAmountPaid` (legacy cap when a single oversized payment exceeds recorded).
 */
export function getActiveAmountPaid(
  tx: Pick<Transaction, "payments" | "amountPaid">,
): number {
  const payments = tx.payments ?? [];
  const recorded = Math.max(0, Number(tx.amountPaid) || 0);
  if (payments.length > 0) {
    const fromPayments = payments.reduce((sum, payment) => {
      if (!isActivePayment(payment)) return sum;
      return sum + Math.max(0, Number(payment.amount) || 0);
    }, 0);
    // Legacy rows can store a lower amountPaid than a single oversized payment line.
    if (recorded > 0 && fromPayments > recorded + 0.0001) {
      return recorded;
    }
    // After void/correction, trust the payments list even if amountPaid is stale.
    return fromPayments;
  }
  return recorded;
}

/**
 * Derive balanceDue + paymentStatus from totals (shared by create/update/portal/messenger).
 * When `totalAmount` is 0 and `amountPaid` > 0, status is `paid` (zero-price / free rows).
 */
export function derivePaymentFields(
  totalAmount: number,
  amountPaid: number,
): {
  amountPaid: number;
  balanceDue: number;
  paymentStatus: Exclude<LedgerPaymentStatus, "N/A">;
} {
  const total = Math.max(0, Number(totalAmount) || 0);
  const paid = Math.max(0, Number(amountPaid) || 0);
  const balanceDue = Math.max(0, total - paid);

  let paymentStatus: Exclude<LedgerPaymentStatus, "N/A"> = "unpaid";
  if (total > 0) {
    if (balanceDue <= 0) paymentStatus = "paid";
    else if (paid > 0) paymentStatus = "partial";
    else paymentStatus = "unpaid";
  } else if (paid > 0) {
    paymentStatus = "paid";
  }

  return { amountPaid: paid, balanceDue, paymentStatus };
}

/**
 * Derive payment fields from active (non-voided) payment rows on a transaction-like object.
 */
export function derivePaymentFieldsFromTransaction(
  tx: Pick<Transaction, "totalAmount" | "amountPaid" | "payments">,
): ReturnType<typeof derivePaymentFields> {
  return derivePaymentFields(
    tx.totalAmount ?? 0,
    getActiveAmountPaid(tx),
  );
}
