import { describe, expect, it } from "vitest";
import {
  buildPaymentReconcileUpdates,
  resolveIntentStatusAfterPayment,
} from "../../../../services/payments/payment-reconcile-service";
import type { Transaction } from "../../../../services/transactions/transaction-service";

function baseTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    referenceId: "TX-001",
    type: "delivery",
    customerId: "cust-1",
    customerName: "Juan",
    totalAmount: 500,
    amountPaid: 0,
    balanceDue: 500,
    paymentStatus: "unpaid",
    deliveryStatus: "pending",
    payments: [],
    ...overrides,
  } as Transaction;
}

describe("buildPaymentReconcileUpdates", () => {
  it("marks transaction paid on full payment", () => {
    const result = buildPaymentReconcileUpdates(baseTx(), 500, {
      paymentId: "pay-1",
      reference: "GCASH-1",
    });
    expect(result.duplicate).toBe(false);
    expect(result.appliedAmount).toBe(500);
    expect(result.overpayAmount).toBe(0);
    expect(result.paymentStatus).toBe("paid");
    expect(result.updates.balanceDue).toBe(0);
    expect(result.updates.amountPaid).toBe(500);
  });

  it("handles partial payment", () => {
    const result = buildPaymentReconcileUpdates(baseTx(), 200, {
      paymentId: "pay-partial",
    });
    expect(result.paymentStatus).toBe("partial");
    expect(result.appliedAmount).toBe(200);
    expect(result.updates.balanceDue).toBe(300);
  });

  it("caps overpay and records surplus", () => {
    const result = buildPaymentReconcileUpdates(baseTx(), 600, {
      paymentId: "pay-over",
    });
    expect(result.appliedAmount).toBe(500);
    expect(result.overpayAmount).toBe(100);
    expect(result.paymentStatus).toBe("paid");
  });

  it("ignores duplicate payment id", () => {
    const tx = baseTx({
      payments: [{ id: "pay-dup", amount: 200, date: "2026-01-01", method: "digital_wallet" }],
      amountPaid: 200,
      balanceDue: 300,
      paymentStatus: "partial",
    });
    const result = buildPaymentReconcileUpdates(tx, 200, {
      paymentId: "pay-dup",
    });
    expect(result.duplicate).toBe(true);
    expect(result.appliedAmount).toBe(0);
    expect(Object.keys(result.updates)).toHaveLength(0);
  });

  it("appends to existing partial payments", () => {
    const tx = baseTx({
      payments: [{ id: "pay-a", amount: 200, date: "2026-01-01", method: "cash" }],
      amountPaid: 200,
      balanceDue: 300,
      paymentStatus: "partial",
    });
    const result = buildPaymentReconcileUpdates(tx, 300, {
      paymentId: "pay-b",
    });
    expect(result.paymentStatus).toBe("paid");
    const payments = result.updates.payments as Array<{ id: string; amount: number }>;
    expect(payments).toHaveLength(2);
    expect(payments[1].amount).toBe(300);
  });
});

describe("resolveIntentStatusAfterPayment", () => {
  it("returns paid for full match", () => {
    expect(resolveIntentStatusAfterPayment(500, 500, 500, 0, true)).toBe("paid");
  });

  it("returns partial when received less than requested", () => {
    expect(resolveIntentStatusAfterPayment(500, 200, 200, 0, true)).toBe("partial");
  });

  it("returns overpaid when surplus", () => {
    expect(resolveIntentStatusAfterPayment(500, 600, 500, 100, true)).toBe("overpaid");
  });

  it("returns unmatched when transaction missing", () => {
    expect(resolveIntentStatusAfterPayment(500, 500, 0, 0, false)).toBe("unmatched");
  });
});
