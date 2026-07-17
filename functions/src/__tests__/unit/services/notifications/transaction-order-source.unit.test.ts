import { describe, expect, it } from "vitest";
import {
  mapPortalOrderKindToSource,
  notificationTitleWithOrderSource,
  resolveTransactionOrderSource,
  transactionOrderSourceLabel,
} from "../../../../services/notifications/transaction-order-source";
import type { Transaction } from "../../../../services/transactions/transaction-service";

function tx(partial: Partial<Transaction>): Transaction {
  return {
    businessId: "biz-1",
    referenceId: "REF-1",
    customerName: "Test Customer",
    totalAmount: 100,
    amountPaid: 0,
    balanceDue: 100,
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    deliveryStatus: "pending",
    type: "delivery",
    ...partial,
  } as Transaction;
}

describe("transaction-order-source", () => {
  it("labels QR and manual sources distinctly", () => {
    expect(transactionOrderSourceLabel("qr_order")).toBe("Order QR");
    expect(transactionOrderSourceLabel("qr_walkin")).toBe("Walk-in QR");
    expect(transactionOrderSourceLabel("qr_collection")).toBe("Collection QR");
    expect(transactionOrderSourceLabel("manual")).toBe("Manual");
  });

  it("detects order QR delivery transactions from portal notes", () => {
    expect(
      resolveTransactionOrderSource(
        tx({ type: "delivery", deliveryStatus: "placed", notes: "Portal order" }),
      ),
    ).toBe("qr_order");
  });

  it("treats staff Add Order placed delivery as manual, not QR", () => {
    expect(
      resolveTransactionOrderSource(
        tx({ type: "delivery", deliveryStatus: "placed", notes: "" }),
      ),
    ).toBe("manual");
  });

  it("detects walk-in QR transactions", () => {
    expect(
      resolveTransactionOrderSource(
        tx({
          type: "walkin",
          deliveryStatus: "completed",
          walkInQueueNumber: 4,
          notes: "Counter walk-in order",
        }),
      ),
    ).toBe("qr_walkin");
  });

  it("detects manual delivery transactions", () => {
    expect(
      resolveTransactionOrderSource(
        tx({ type: "delivery", deliveryStatus: "pending", notes: "Phone order" }),
      ),
    ).toBe("manual");
  });

  it("detects QR collection transactions", () => {
    expect(
      resolveTransactionOrderSource(
        tx({
          type: "collection",
          notes: "Portal collection request",
        }),
      ),
    ).toBe("qr_collection");
  });

  it("prefixes notification titles with the source label", () => {
    expect(notificationTitleWithOrderSource("Payment received", "qr_order")).toBe(
      "Order QR · Payment received",
    );
    expect(notificationTitleWithOrderSource("Payment received", "manual")).toBe(
      "Manual · Payment received",
    );
    expect(notificationTitleWithOrderSource("Expense recorded", null)).toBe(
      "Expense recorded",
    );
  });

  it("maps portal order kinds to orderSource metadata", () => {
    expect(mapPortalOrderKindToSource("walkin")).toBe("qr_walkin");
    expect(mapPortalOrderKindToSource("delivery")).toBe("qr_order");
    expect(mapPortalOrderKindToSource("collection")).toBe("qr_collection");
  });
});
