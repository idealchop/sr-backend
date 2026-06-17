import { describe, expect, it } from "vitest";
import {
  isPortalCashPaymentMethod,
  portalPaymentConfirmedByRider,
} from "../../../../services/portal/portal-payment-utils";

describe("portal-payment-utils", () => {
  it("treats cash method as cash payment", () => {
    expect(isPortalCashPaymentMethod("cash")).toBe(true);
    expect(isPortalCashPaymentMethod(undefined)).toBe(true);
    expect(isPortalCashPaymentMethod("digital_wallet")).toBe(false);
  });

  it("defaults cash to confirmed by rider when flag omitted", () => {
    expect(portalPaymentConfirmedByRider({ method: "cash", amountPaid: 100 })).toBe(true);
    expect(portalPaymentConfirmedByRider({ method: "cash", confirmedByRider: true })).toBe(
      true,
    );
  });

  it("does not default non-cash to confirmed by rider", () => {
    expect(portalPaymentConfirmedByRider({ method: "digital_wallet" })).toBe(false);
    expect(
      portalPaymentConfirmedByRider({ method: "digital_wallet", confirmedByRider: true }),
    ).toBe(true);
  });
});
