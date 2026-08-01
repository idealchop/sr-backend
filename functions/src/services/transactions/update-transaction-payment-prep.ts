import { FieldValue } from "../../config/firebase-admin";
import {
  derivePaymentFields,
  getActiveAmountPaid,
} from "./payment-status";
import type { Transaction, TransactionPayment } from "./transaction-types";

type PaymentPrepUpdates = Partial<Transaction>;

function coerceToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isFinite(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Expense UI has one date field: keep scheduledAt and active payment dates identical.
 */
function syncExpenseDateFields(
  current: Transaction,
  updates: PaymentPrepUpdates,
): void {
  const effectiveType = updates.type ?? current.type;
  if (effectiveType !== "expense") return;

  if (updates.scheduledAt && typeof updates.scheduledAt === "string") {
    updates.scheduledAt = new Date(updates.scheduledAt);
  }

  let expenseDate = coerceToDate(updates.scheduledAt);

  if (!expenseDate && updates.payments?.length) {
    const active = updates.payments.find((payment) => !payment.voided);
    expenseDate = coerceToDate(active?.date) ?? null;
    if (expenseDate) {
      updates.scheduledAt = expenseDate;
    }
  }

  if (!expenseDate) return;

  const sourcePayments =
    updates.payments !== undefined ? updates.payments : current.payments;
  if (!sourcePayments?.length) return;

  updates.payments = sourcePayments.map((payment: TransactionPayment) => {
    if (payment.voided) return payment;
    return {
      ...payment,
      date: expenseDate,
    };
  });
}

/**
 * Mutates `updates` to keep amountPaid / payments[] / balanceDue / paymentStatus
 * consistent (void-aware). Also coerces string scheduledAt → Date and keeps
 * expense scheduledAt in sync with payment date(s).
 */
export function applyUpdatePaymentFields(
  current: Transaction,
  updates: PaymentPrepUpdates,
): void {
  if (updates.payments !== undefined) {
    updates.amountPaid = getActiveAmountPaid({
      payments: updates.payments,
      amountPaid: updates.amountPaid ?? current.amountPaid ?? 0,
    });
  }

  if (
    updates.totalAmount !== undefined ||
    updates.amountPaid !== undefined ||
    updates.payments !== undefined
  ) {
    const total = updates.totalAmount ?? current.totalAmount ?? 0;
    const paid = updates.amountPaid ?? current.amountPaid ?? 0;

    if (updates.amountPaid !== undefined && updates.payments === undefined) {
      const currentPaid = current.amountPaid || 0;
      if (paid > currentPaid) {
        const delta = paid - currentPaid;
        const currentPayments = current.payments || [];

        if (currentPayments.length === 0 && currentPaid > 0) {
          updates.payments = [
            {
              id: `pay-init-${Date.now()}`,
              amount: currentPaid,
              date:
                current.scheduledAt ||
                current.createdAt ||
                FieldValue.serverTimestamp(),
              method: current.paymentMethod || "cash",
              notes: "Initial payment (migrated)",
            },
            {
              id: `pay-upd-${Date.now()}`,
              amount: delta,
              date: FieldValue.serverTimestamp(),
              method: updates.paymentMethod || current.paymentMethod || "cash",
              notes: "Additional payment",
            },
          ];
        } else {
          updates.payments = [
            ...currentPayments,
            {
              id: `pay-upd-${Date.now()}`,
              amount: delta,
              date: FieldValue.serverTimestamp(),
              method: updates.paymentMethod || current.paymentMethod || "cash",
              notes: "Additional payment",
            },
          ];
        }
      }
    }

    const derived = derivePaymentFields(total, paid);
    updates.balanceDue = derived.balanceDue;
    updates.paymentStatus = derived.paymentStatus;
  }

  if (updates.scheduledAt && typeof updates.scheduledAt === "string") {
    updates.scheduledAt = new Date(updates.scheduledAt);
  }

  syncExpenseDateFields(current, updates);
}
