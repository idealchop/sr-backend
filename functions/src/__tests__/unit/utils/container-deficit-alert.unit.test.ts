import { describe, expect, it } from "vitest";
import { buildContainerDeficitAlerts } from "../../../utils/container-deficit-alert";
import type { Transaction } from "../../../services/transactions/transaction-service";

describe("container-deficit-alert", () => {
  const now = new Date("2026-06-21T12:00:00+08:00");

  it("counts sukis with open container deficit on fulfilled deliveries", () => {
    const snapshot = buildContainerDeficitAlerts(
      [
        {
          businessId: "b1",
          referenceId: "TX-100",
          type: "delivery",
          customerId: "c1",
          customerName: "Ana",
          totalAmount: 100,
          amountPaid: 100,
          balanceDue: 0,
          paymentStatus: "paid",
          paymentMethod: "cash",
          deliveryStatus: "delivered",
          scheduledAt: "2026-06-15T08:00:00+08:00",
          collectionItems: [
            {
              inventoryId: "jar",
              name: "5G jar",
              qtyExpected: 2,
              qtyCollected: 1,
              qtyOk: 1,
              qtyDamaged: 0,
              qtyMissing: 0,
              deficitQty: 1,
              status: "pending",
            },
          ],
        } as Transaction,
      ],
      [{ id: "c1", name: "Ana", businessId: "b1" }],
      now,
    );

    expect(snapshot.count).toBe(1);
    expect(snapshot.totalDeficitQty).toBe(1);
  });
});
