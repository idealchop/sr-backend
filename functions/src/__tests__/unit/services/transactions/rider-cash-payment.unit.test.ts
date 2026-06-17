import { describe, expect, it } from "vitest";
import {
  initialPaymentConfirmedByRider,
  initialPaymentNotesForCreate,
  staffPaymentConfirmedByRider,
} from "../../../../services/transactions/rider-cash-payment";

describe("rider-cash-payment", () => {
  it("marks rider cash orders as received by default", () => {
    expect(initialPaymentConfirmedByRider("cash", "rider-1")).toBe(true);
    expect(initialPaymentNotesForCreate("cash", "rider-1")).toContain(
      "received by rider",
    );
    expect(initialPaymentConfirmedByRider("cash", undefined)).toBeUndefined();
    expect(initialPaymentNotesForCreate("cash", undefined)).toBe(
      "Initial payment",
    );
  });

  it("matches portal cash confirmation semantics", () => {
    expect(staffPaymentConfirmedByRider({ method: "cash" })).toBe(true);
    expect(
      staffPaymentConfirmedByRider({ method: "cash", confirmedByRider: false }),
    ).toBe(false);
  });
});
