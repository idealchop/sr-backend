import { describe, expect, it } from "vitest";
import {
  mapDeliveryStatusToEvent,
  mapPaymentUpdateNotifyKey,
} from "../../../../services/portal/customer-transaction-notifier";
import type { Transaction } from "../../../../services/transactions/transaction-service";

describe("mapDeliveryStatusToEvent", () => {
  it("maps delivered to completed", () => {
    expect(mapDeliveryStatusToEvent("in-transit", "delivered")).toBe("completed");
    expect(mapDeliveryStatusToEvent("placed", "delivered")).toBe("completed");
  });

  it("maps in-transit hyphen status to in_transit event", () => {
    expect(mapDeliveryStatusToEvent("placed", "in-transit")).toBe("in_transit");
    expect(mapDeliveryStatusToEvent("pending", "in_transit")).toBe("in_transit");
  });

  it("maps placed to order_accepted from pending", () => {
    expect(mapDeliveryStatusToEvent("pending", "placed")).toBe("order_accepted");
  });

  it("returns null when status unchanged", () => {
    expect(mapDeliveryStatusToEvent("delivered", "delivered")).toBeNull();
  });
});

describe("mapPaymentUpdateNotifyKey", () => {
  const base = {
    customerId: "c1",
    referenceId: "TX-001",
    totalAmount: 1000,
  } as Transaction;

  it("maps unpaid to partial", () => {
    expect(
      mapPaymentUpdateNotifyKey({
        before: { ...base, paymentStatus: "unpaid", amountPaid: 0 },
        after: { ...base, paymentStatus: "partial", amountPaid: 400 },
      }),
    ).toEqual({ eventKey: "payment_partial", kind: "partial" });
  });

  it("maps partial to paid", () => {
    expect(
      mapPaymentUpdateNotifyKey({
        before: { ...base, paymentStatus: "partial", amountPaid: 400 },
        after: { ...base, paymentStatus: "paid", amountPaid: 1000, balanceDue: 0 },
      }),
    ).toEqual({ eventKey: "payment_paid", kind: "paid" });
  });

  it("maps additional partial top-up", () => {
    expect(
      mapPaymentUpdateNotifyKey({
        before: { ...base, paymentStatus: "partial", amountPaid: 400 },
        after: { ...base, paymentStatus: "partial", amountPaid: 700 },
      }),
    ).toEqual({ eventKey: "payment_partial_70000", kind: "partial" });
  });

  it("ignores N/A payment status", () => {
    expect(
      mapPaymentUpdateNotifyKey({
        before: { ...base, paymentStatus: "unpaid", amountPaid: 0 },
        after: { ...base, paymentStatus: "N/A", amountPaid: 0 },
      }),
    ).toBeNull();
  });
});
