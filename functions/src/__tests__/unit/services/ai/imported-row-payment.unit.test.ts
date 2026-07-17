import { describe, expect, it } from "vitest";
import { resolveImportedRowPayment } from "../../../../services/ai/imported-row-payment";

describe("resolveImportedRowPayment", () => {
  it("maps paid / unpaid / partial heuristics", () => {
    expect(resolveImportedRowPayment({ paymentStatus: "paid" }, 100)).toEqual({
      amountPaid: 100,
      paymentStatus: "paid",
    });
    expect(resolveImportedRowPayment({ paymentStatus: "partial" }, 100)).toEqual({
      amountPaid: 50,
      paymentStatus: "partial",
    });
    expect(resolveImportedRowPayment({ paymentStatus: "unpaid" }, 100)).toEqual({
      amountPaid: 0,
      paymentStatus: "unpaid",
    });
  });

  it("defaults delivered rows without status to paid", () => {
    expect(
      resolveImportedRowPayment({ deliveryStatus: "delivered" }, 80),
    ).toEqual({ amountPaid: 80, paymentStatus: "paid" });
  });
});
