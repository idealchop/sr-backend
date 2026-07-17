import { FieldValue } from "../../config/firebase-admin";
import type { Transaction } from "../transactions/transaction-service";
import { derivePaymentFields } from "../transactions/payment-status";

export type PaymentReconcileResult = {
  updates: Record<string, unknown>;
  appliedAmount: number;
  overpayAmount: number;
  paymentStatus: Transaction["paymentStatus"];
  duplicate: boolean;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Builds a transaction patch when a provider webhook confirms payment.
 * Caps applied amount at balance due; surplus is reported as overpay.
 */
export function buildPaymentReconcileUpdates(
  current: Transaction,
  amountPaid: number,
  options: {
    method?: string;
    reference?: string;
    paymentId: string;
    paidAt?: Date;
    notePrefix?: string;
  },
): PaymentReconcileResult {
  const incremental = Math.max(0, roundMoney(amountPaid));
  if (incremental <= 0) {
    return {
      updates: {},
      appliedAmount: 0,
      overpayAmount: 0,
      paymentStatus: current.paymentStatus || "unpaid",
      duplicate: false,
    };
  }

  const declaredTotal = roundMoney(Number(current.totalAmount ?? 0));
  const prevPaid = roundMoney(Number(current.amountPaid ?? 0));
  const balanceBefore = Math.max(0, roundMoney(declaredTotal - prevPaid));
  const appliedAmount = balanceBefore > 0 ?
    Math.min(balanceBefore, incremental) :
    0;
  const overpayAmount = roundMoney(Math.max(0, incremental - appliedAmount));
  const newPaid = roundMoney(prevPaid + appliedAmount);
  const { balanceDue, paymentStatus } = derivePaymentFields(declaredTotal, newPaid);

  const method = options.method || "digital_wallet";
  const payNotes = [
    options.reference && `Ref: ${options.reference}`,
    options.notePrefix,
    overpayAmount > 0 ? `Overpay ₱${overpayAmount.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(" · ") || "GCash/Maya auto-reconcile";

  const payList = [...(current.payments || [])];
  const existing = payList.find((p) => p.id === options.paymentId);
  if (existing) {
    return {
      updates: {},
      appliedAmount: 0,
      overpayAmount: 0,
      paymentStatus: current.paymentStatus || "unpaid",
      duplicate: true,
    };
  }

  let payDate: Date | ReturnType<typeof FieldValue.serverTimestamp> =
    FieldValue.serverTimestamp();
  if (options.paidAt && !Number.isNaN(options.paidAt.getTime())) {
    payDate = options.paidAt;
  }

  if (appliedAmount > 0) {
    payList.push({
      id: options.paymentId,
      amount: appliedAmount,
      date: payDate,
      method,
      notes: payNotes,
    });
  }

  const portalBlock = `[Auto payment] ${payNotes}`.trim();
  const base = ((current.notes as string) || "").trim();
  const mergedNotes = base ? `${base}\n${portalBlock}` : portalBlock;

  const updates: Record<string, unknown> = {
    amountPaid: newPaid,
    balanceDue,
    paymentStatus,
    payments: payList,
    paymentMethod: method,
    notes: mergedNotes,
  };

  return {
    updates,
    appliedAmount,
    overpayAmount,
    paymentStatus,
    duplicate: false,
  };
}

export function resolveIntentStatusAfterPayment(
  amountRequested: number,
  amountReceived: number,
  appliedAmount: number,
  overpayAmount: number,
  matched: boolean,
): "paid" | "partial" | "overpaid" | "unmatched" | "pending" {
  if (!matched) return "unmatched";
  if (amountReceived <= 0) return "pending";
  if (overpayAmount > 0.0001) return "overpaid";
  if (appliedAmount >= amountRequested - 0.0001) return "paid";
  if (appliedAmount > 0) return "partial";
  return "pending";
}
