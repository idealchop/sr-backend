import { describe, expect, it } from "vitest";
import { buildLowHealthSample } from "../../../utils/suki-health-score";
import type { Customer } from "../../../services/customers/customer-service";
import type { Transaction } from "../../../services/transactions/transaction-service";

function customer(id: string, name: string): Customer {
  return {
    id,
    businessId: "biz-1",
    name,
    type: "residential",
    phone: "09171234567",
    address: "Test",
    isDeliveryEnabled: true,
    isCollectionEnabled: false,
    status: "active",
  };
}

describe("buildLowHealthSample", () => {
  it("returns lowest scores first with unpaid balance", () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const customers = [customer("c1", "Healthy Suki"), customer("c2", "At Risk Suki")];
    const transactions: Transaction[] = [
      {
        id: "t1",
        businessId: "biz-1",
        customerId: "c1",
        customerName: "Healthy Suki",
        type: "delivery",
        deliveryStatus: "delivered",
        paymentStatus: "paid",
        balanceDue: 0,
        totalAmount: 100,
        createdAt: "2026-05-28T08:00:00Z",
        deliveredAt: "2026-05-28T10:00:00Z",
      } as Transaction,
      {
        id: "t2",
        businessId: "biz-1",
        customerId: "c2",
        customerName: "At Risk Suki",
        type: "delivery",
        deliveryStatus: "delivered",
        paymentStatus: "partial",
        balanceDue: 500,
        totalAmount: 500,
        createdAt: "2026-03-01T08:00:00Z",
        deliveredAt: "2026-03-01T10:00:00Z",
      } as Transaction,
    ];

    const sample = buildLowHealthSample(customers, transactions, now, 5);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample[0].name).toBe("At Risk Suki");
    expect(sample[0].score).toBeLessThan(sample[sample.length - 1]?.score ?? 100);
    expect(sample[0].unpaidBalancePhp).toBe(500);
  });
});
