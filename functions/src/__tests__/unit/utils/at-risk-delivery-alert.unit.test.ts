import { describe, expect, it } from "vitest";
import {
  buildAtRiskDeliverySnapshot,
  pendingOrderCustomerIds,
} from "../../../utils/at-risk-delivery-alert";
import type { Transaction } from "../../../services/transactions/transaction-service";

describe("at-risk-delivery-alert", () => {
  it("flags open deliveries", () => {
    const snapshot = buildAtRiskDeliverySnapshot(
      [
        {
          businessId: "b1",
          referenceId: "TX-001",
          type: "delivery",
          customerId: "c1",
          customerName: "Ana",
          totalAmount: 100,
          amountPaid: 0,
          balanceDue: 100,
          paymentStatus: "unpaid",
          paymentMethod: "cash",
          deliveryStatus: "in-transit",
        } as Transaction,
      ],
      [{ id: "c1", name: "Ana", businessId: "b1" }],
    );

    expect(snapshot.count).toBe(1);
    expect(snapshot.rows[0]?.reasons[0]).toContain("in transit");
  });

  it("includes pending portal orders without duplicating delivery rows", () => {
    const snapshot = buildAtRiskDeliverySnapshot(
      [],
      [{ id: "c2", name: "Ben", businessId: "b1" }],
      new Set(["c2"]),
    );

    expect(snapshot.count).toBe(1);
    expect(snapshot.rows[0]?.reasons[0]).toContain("Pending portal order");
  });

  it("extracts pending order customer ids from submissions", () => {
    const ids = pendingOrderCustomerIds([
      { customerId: "c1", submissionType: "PLACE_ORDER" },
      { customerId: "c2", submissionType: "MARK_TX_COMPLETE" },
    ]);
    expect([...ids]).toEqual(["c1"]);
  });
});
