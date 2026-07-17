import { FieldValue } from "../../config/firebase-admin";
import {
  derivePaymentFields,
  getActiveAmountPaid,
} from "./payment-status";
import type { Transaction } from "./transaction-types";

type PaymentPrepUpdates = Partial<Transaction>;

/**
 * Mutates `updates` to keep amountPaid / payments[] / balanceDue / paymentStatus
 * consistent (void-aware). Also coerces string scheduledAt → Date.
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
}
