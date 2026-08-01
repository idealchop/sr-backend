import { describe, expect, it } from "vitest";
import { applyUpdatePaymentFields } from "../../../../services/transactions/update-transaction-payment-prep";
import type { Transaction } from "../../../../services/transactions/transaction-types";

function baseTx(partial: Partial<Transaction> = {}): Transaction {
  return {
    businessId: "biz1",
    referenceId: "TX-1",
    type: "delivery",
    customerName: "Ada",
    totalAmount: 100,
    amountPaid: 0,
    balanceDue: 100,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    deliveryStatus: "pending",
    ...partial,
  };
}

describe("applyUpdatePaymentFields", () => {
  it("derives balance and status from amountPaid", () => {
    const updates: Partial<Transaction> = { amountPaid: 40 };
    applyUpdatePaymentFields(baseTx(), updates);
    expect(updates.balanceDue).toBe(60);
    expect(updates.paymentStatus).toBe("partial");
  });

  it("recomputes amountPaid from active payments when voiding", () => {
    const current = baseTx({
      amountPaid: 100,
      balanceDue: 0,
      paymentStatus: "paid",
      payments: [
        { id: "p1", amount: 100, date: "2026-01-01", method: "cash" },
      ],
    });
    const updates: Partial<Transaction> = {
      payments: [
        { id: "p1", amount: 100, date: "2026-01-01", method: "cash", voided: true },
        { id: "p2", amount: 30, date: "2026-01-02", method: "cash" },
      ],
      amountPaid: 100,
    };
    applyUpdatePaymentFields(current, updates);
    expect(updates.amountPaid).toBe(30);
    expect(updates.balanceDue).toBe(70);
    expect(updates.paymentStatus).toBe("partial");
  });

  it("appends a payment row when amountPaid increases without payments[]", () => {
    const updates: Partial<Transaction> = { amountPaid: 50 };
    applyUpdatePaymentFields(
      baseTx({ amountPaid: 20, payments: [
        { id: "p1", amount: 20, date: "2026-01-01", method: "cash" },
      ] }),
      updates,
    );
    expect(updates.payments?.length).toBe(2);
    expect(updates.payments?.[1]?.amount).toBe(30);
    expect(updates.paymentStatus).toBe("partial");
  });

  it("treats zero-total with paid as paid", () => {
    const updates: Partial<Transaction> = { amountPaid: 10 };
    applyUpdatePaymentFields(baseTx({ totalAmount: 0, balanceDue: 0 }), updates);
    expect(updates.paymentStatus).toBe("paid");
    expect(updates.balanceDue).toBe(0);
  });

  it("keeps expense scheduledAt and payment date identical when date changes", () => {
    const current = baseTx({
      type: "expense",
      customerName: "Expense",
      totalAmount: 250,
      amountPaid: 250,
      balanceDue: 0,
      paymentStatus: "paid",
      deliveryStatus: "completed",
      scheduledAt: "2026-06-25T00:00:00.000Z",
      payments: [
        { id: "pay-1", amount: 250, date: "2026-06-25T00:00:00.000Z", method: "cash" },
      ],
    });
    const updates: Partial<Transaction> = {
      scheduledAt: "2026-08-01T00:00:00.000Z",
      payments: [
        { id: "pay-1", amount: 250, date: "2026-08-01T00:00:00.000Z", method: "cash" },
      ],
      amountPaid: 250,
    };

    applyUpdatePaymentFields(current, updates);

    expect(updates.scheduledAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(updates.payments?.[0]?.date).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("syncs expense payment dates when only scheduledAt is patched", () => {
    const current = baseTx({
      type: "expense",
      customerName: "Expense",
      totalAmount: 100,
      amountPaid: 100,
      balanceDue: 0,
      paymentStatus: "paid",
      deliveryStatus: "completed",
      scheduledAt: "2026-06-25T00:00:00.000Z",
      payments: [
        { id: "pay-1", amount: 100, date: "2026-06-25T00:00:00.000Z", method: "cash" },
      ],
    });
    const updates: Partial<Transaction> = {
      scheduledAt: "2026-08-01T08:30:00.000Z",
    };

    applyUpdatePaymentFields(current, updates);

    expect(updates.payments?.[0]?.date).toEqual(new Date("2026-08-01T08:30:00.000Z"));
  });
});
