import { describe, expect, it } from "vitest";
import {
  assertPortalAdvancePaymentFullAmount,
  buildPortalBalancePaymentUpdates,
  expectedPortalCustomerPaymentAmount,
} from "../../../../services/portal/portal-balance-payment";
import type { Transaction } from "../../../../services/transactions/transaction-types";

function baseTx(over: Partial<Transaction> = {}): Transaction {
  return {
    businessId: "b1",
    referenceId: "TX-1",
    type: "delivery",
    customerName: "Test",
    totalAmount: 100,
    amountPaid: 0,
    balanceDue: 100,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    deliveryStatus: "pending",
    ...over,
  };
}

describe("assertPortalAdvancePaymentFullAmount", () => {
  it("requires order + priority fee + tip for advance pay", () => {
    const payload = {
      portalPaymentPhase: "advance" as const,
      deliverySpeed: "priority" as const,
      deliverySpeedFee: 79,
      riderTipAmount: 50,
      payment: { amountPaid: 180, method: "gcash" },
    };
    // Expected: 100 + 79 + 50 = 229
    expect(expectedPortalCustomerPaymentAmount(baseTx(), payload)).toBe(229);
    expect(() =>
      assertPortalAdvancePaymentFullAmount(baseTx(), payload),
    ).toThrow("ADVANCE_PAYMENT_AMOUNT_INSUFFICIENT");

    expect(() =>
      assertPortalAdvancePaymentFullAmount(baseTx(), {
        ...payload,
        payment: { amountPaid: 229, method: "gcash" },
      }),
    ).not.toThrow();
  });

  it("skips check for non-advance balance payments", () => {
    expect(() =>
      assertPortalAdvancePaymentFullAmount(baseTx(), {
        portalPaymentPhase: "balance",
        payment: { amountPaid: 10, method: "gcash" },
      }),
    ).not.toThrow();
  });
});

describe("buildPortalBalancePaymentUpdates tip + delivery speed", () => {
  it("bumps station total with priority fee only; tip stays rider-only", () => {
    const updates = buildPortalBalancePaymentUpdates(baseTx(), {
      portalPaymentPhase: "advance",
      deliverySpeed: "priority",
      deliverySpeedFee: 79,
      riderTipAmount: 50,
      payment: {
        amountPaid: 229,
        method: "acct_gcash",
        reference: "GC-1",
      },
    });

    // Order 100 + priority 79 = 179; tip 50 excluded from station total.
    expect(updates.totalAmount).toBe(179);
    expect(updates.amountPaid).toBe(179);
    expect(updates.paymentStatus).toBe("paid");
    expect(updates.balanceDue).toBe(0);
    expect(updates.deliverySpeed).toBe("priority");
    expect(updates.deliverySpeedFee).toBe(79);
    expect(updates.riderTipAmount).toBe(50);
    expect(updates.paymentMethod).toBe("acct_gcash");
    expect(String(updates.notes)).toContain("not in station total");
  });

  it("maps legacy saver to express and does not double-count extras", () => {
    const first = buildPortalBalancePaymentUpdates(baseTx(), {
      portalPaymentPhase: "advance",
      deliverySpeed: "saver",
      deliverySpeedFee: 37,
      riderTipAmount: 20,
      payment: { amountPaid: 157, method: "digital_wallet" },
    });
    expect(first.deliverySpeed).toBe("express");
    // 100 + 37 speed; tip 20 excluded
    expect(first.totalAmount).toBe(137);
    expect(first.amountPaid).toBe(137);
    expect(first.riderTipAmount).toBe(20);

    const second = buildPortalBalancePaymentUpdates(
      {
        ...baseTx(),
        totalAmount: 137,
        amountPaid: 137,
        balanceDue: 0,
        paymentStatus: "paid",
        deliverySpeed: "express",
        deliverySpeedFee: 37,
        riderTipAmount: 20,
      },
      {
        portalPaymentPhase: "advance",
        deliverySpeed: "express",
        deliverySpeedFee: 37,
        riderTipAmount: 20,
        payment: { amountPaid: 10, method: "digital_wallet" },
      },
    );
    expect(second.totalAmount).toBe(137);
    expect(second.deliverySpeedFee).toBe(37);
    expect(second.riderTipAmount).toBe(20);
  });
});
