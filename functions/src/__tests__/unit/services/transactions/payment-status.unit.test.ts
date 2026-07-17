import { describe, expect, it } from "vitest";
import {
  derivePaymentFields,
  derivePaymentFieldsFromTransaction,
  getActiveAmountPaid,
  isActivePayment,
} from "../../../../services/transactions/payment-status";

describe("derivePaymentFields", () => {
  it("marks paid when balance is cleared", () => {
    expect(derivePaymentFields(100, 100)).toEqual({
      amountPaid: 100,
      balanceDue: 0,
      paymentStatus: "paid",
    });
  });

  it("marks partial when some paid", () => {
    expect(derivePaymentFields(100, 40)).toEqual({
      amountPaid: 40,
      balanceDue: 60,
      paymentStatus: "partial",
    });
  });

  it("marks unpaid when nothing paid", () => {
    expect(derivePaymentFields(100, 0)).toEqual({
      amountPaid: 0,
      balanceDue: 100,
      paymentStatus: "unpaid",
    });
  });

  it("treats zero-total with payment as paid", () => {
    expect(derivePaymentFields(0, 10)).toEqual({
      amountPaid: 10,
      balanceDue: 0,
      paymentStatus: "paid",
    });
  });
});

describe("getActiveAmountPaid", () => {
  it("skips voided payment rows", () => {
    expect(
      getActiveAmountPaid({
        amountPaid: 100,
        payments: [
          { id: "a", amount: 100, date: "2026-01-01", method: "cash" },
          { id: "b", amount: 50, date: "2026-01-02", method: "cash", voided: true },
        ],
      }),
    ).toBe(100);
  });

  it("trusts payments after void even when amountPaid is stale", () => {
    expect(
      getActiveAmountPaid({
        amountPaid: 150,
        payments: [
          { id: "a", amount: 100, date: "2026-01-01", method: "cash" },
          { id: "b", amount: 50, date: "2026-01-02", method: "cash", voided: true },
        ],
      }),
    ).toBe(100);
  });

  it("caps oversized legacy payment lines to recorded amountPaid", () => {
    expect(
      getActiveAmountPaid({
        amountPaid: 50,
        payments: [
          { id: "a", amount: 500, date: "2026-01-01", method: "cash" },
        ],
      }),
    ).toBe(50);
  });

  it("falls back to amountPaid when payments are absent", () => {
    expect(getActiveAmountPaid({ amountPaid: 75, payments: [] })).toBe(75);
  });
});

describe("derivePaymentFieldsFromTransaction", () => {
  it("derives from active payments", () => {
    expect(
      derivePaymentFieldsFromTransaction({
        totalAmount: 200,
        amountPaid: 200,
        payments: [
          { id: "a", amount: 200, date: "2026-01-01", method: "cash", voided: true },
          { id: "b", amount: 80, date: "2026-01-02", method: "cash" },
        ],
      }),
    ).toEqual({
      amountPaid: 80,
      balanceDue: 120,
      paymentStatus: "partial",
    });
  });
});

describe("isActivePayment", () => {
  it("treats missing voided as active", () => {
    expect(isActivePayment({ voided: undefined })).toBe(true);
    expect(isActivePayment({ voided: true })).toBe(false);
  });
});
