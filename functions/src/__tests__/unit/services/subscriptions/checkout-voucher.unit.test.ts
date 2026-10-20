import { describe, expect, it } from "vitest";
import {
  amountDueAfterVoucher,
  evaluateCheckoutVoucher,
} from "../../../../services/subscriptions/checkout-voucher";

describe("evaluateCheckoutVoucher", () => {
  const base = {
    voucherId: "voucher_full",
    planCode: "starter",
    billingCycle: "monthly",
    subtotal: 399,
  };

  it("applies a 100% voucher so the due amount is ₱0", () => {
    const result = evaluateCheckoutVoucher({
      ...base,
      voucher: {
        isActive: true,
        discountType: "percentage",
        discountValue: 100,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.discountAmount).toBe(399);
    expect(amountDueAfterVoucher(base.subtotal, result.discountAmount)).toBe(0);
  });

  it("caps a fixed voucher at the subtotal", () => {
    const result = evaluateCheckoutVoucher({
      ...base,
      voucher: {
        isActive: true,
        discountType: "fixed_amount",
        discountValue: 500,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.discountAmount).toBe(399);
    expect(amountDueAfterVoucher(base.subtotal, result.discountAmount)).toBe(0);
  });

  it("leaves a remainder for PayMongo when the voucher is partial", () => {
    const result = evaluateCheckoutVoucher({
      ...base,
      voucher: {
        isActive: true,
        discountType: "fixed_amount",
        discountValue: 100,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(amountDueAfterVoucher(base.subtotal, result.discountAmount)).toBe(299);
  });

  it("rejects a voucher that does not match the plan", () => {
    const result = evaluateCheckoutVoucher({
      ...base,
      voucher: {
        isActive: true,
        discountType: "percentage",
        discountValue: 100,
        applicablePlanCodes: ["scale"],
      },
    });
    expect(result.valid).toBe(false);
  });
});
