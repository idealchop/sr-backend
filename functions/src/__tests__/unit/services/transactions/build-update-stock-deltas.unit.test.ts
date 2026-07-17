import { describe, expect, it } from "vitest";
import { buildUpdateStockDeltaPlan } from "../../../../services/transactions/build-update-stock-deltas";
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
    salesStockApplied: false,
    items: [
      { inventoryId: "inv-1", name: "Gallon", quantity: 2 },
    ],
    ...partial,
  };
}

describe("buildUpdateStockDeltaPlan", () => {
  it("deducts sales stock when becoming dispatched", () => {
    const plan = buildUpdateStockDeltaPlan({
      current: baseTx(),
      updates: { deliveryStatus: "placed" },
      nextDeliveryStatus: "placed",
      nextCollectionItems: [],
      skippingInventoryMutation: false,
    });
    expect(plan.becomingDispatched).toBe(true);
    expect(plan.didDispatchSalesInventory).toBe(true);
    expect(plan.stockDeltas.get("inv-1")).toBe(-2);
  });

  it("skips inventory when cancelling", () => {
    const plan = buildUpdateStockDeltaPlan({
      current: baseTx({ deliveryStatus: "placed", salesStockApplied: true }),
      updates: { deliveryStatus: "cancelled" },
      nextDeliveryStatus: "cancelled",
      nextCollectionItems: [],
      skippingInventoryMutation: true,
    });
    expect(plan.stockDeltas.size).toBe(0);
  });
});
