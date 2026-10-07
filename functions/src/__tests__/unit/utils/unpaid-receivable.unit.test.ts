import { describe, expect, it } from "vitest";
import {
  isTransactionFulfilledForReceivable,
  isUnpaidReceivableTransaction,
  outstandingBalanceDue,
} from "../../../utils/unpaid-receivable";
import { computeDebtAgingBreakdown } from "../../../utils/analytics-utils";

describe("unpaid-receivable", () => {
  it("treats placed / pending / in-transit deliveries as not fulfilled", () => {
    for (const deliveryStatus of ["placed", "pending", "in-transit", "PLACED"]) {
      expect(
        isTransactionFulfilledForReceivable({
          type: "delivery",
          deliveryStatus,
        } as any),
      ).toBe(false);
      expect(
        isUnpaidReceivableTransaction({
          type: "delivery",
          deliveryStatus,
          paymentStatus: "unpaid",
          balanceDue: 180,
        } as any),
      ).toBe(false);
    }
  });

  it("uses the billed total when balanceDue was stored as zero", () => {
    const tx = {
      type: "delivery",
      deliveryStatus: "completed",
      paymentStatus: "unpaid",
      totalAmount: 1000,
      amountPaid: 0,
      balanceDue: 0,
    } as any;
    expect(outstandingBalanceDue(tx)).toBe(1000);
    expect(isUnpaidReceivableTransaction(tx)).toBe(true);
  });

  it("keeps a legacy partial that only stored balanceDue", () => {
    const tx = {
      type: "delivery",
      deliveryStatus: "completed",
      paymentStatus: "partial",
      totalAmount: 100,
      balanceDue: 20,
    } as any;
    expect(outstandingBalanceDue(tx)).toBe(20);
    expect(isUnpaidReceivableTransaction(tx)).toBe(true);
  });

  it("counts completed unpaid deliveries as receivable", () => {
    expect(
      isUnpaidReceivableTransaction({
        type: "delivery",
        deliveryStatus: "completed",
        paymentStatus: "unpaid",
        balanceDue: 135,
      } as any),
    ).toBe(true);
  });
});

describe("computeDebtAgingBreakdown unpaid gate", () => {
  it("excludes on-going unpaid (Paul-style placed order)", () => {
    const now = new Date("2026-07-14");
    const result = computeDebtAgingBreakdown(
      [
        {
          customerId: "paul",
          type: "delivery",
          deliveryStatus: "placed",
          paymentStatus: "unpaid",
          balanceDue: 180,
          scheduledAt: "2026-07-14",
          createdAt: "2026-07-14",
        } as any,
        {
          customerId: "paul",
          type: "delivery",
          deliveryStatus: "completed",
          paymentStatus: "paid",
          balanceDue: 0,
          scheduledAt: "2026-07-07",
          createdAt: "2026-07-07",
        } as any,
      ],
      [
        {
          id: "paul",
          name: "Paul Garcia",
          phone: "1",
          address: "A",
          type: "residential",
          businessId: "b1",
          status: "active",
          isDeliveryEnabled: true,
          isCollectionEnabled: false,
        },
      ],
      now,
    );
    expect(result.rows).toHaveLength(0);
    expect(result.summaryLabel).toBe("All clear");
  });
});
