import { describe, expect, it } from "vitest";
import { transactionHasCustomerRating } from "../../../../services/portal/portal-rating-updates";

describe("transactionHasCustomerRating", () => {
  it("returns false when no ratings or feedback on transaction", () => {
    expect(transactionHasCustomerRating({})).toBe(false);
    expect(transactionHasCustomerRating({ serviceRating: 0 })).toBe(false);
  });

  it("returns true when service, wrs, rider, legacy rating, or feedback exists", () => {
    expect(transactionHasCustomerRating({ serviceRating: 5 })).toBe(true);
    expect(transactionHasCustomerRating({ wrsRating: 4 })).toBe(true);
    expect(transactionHasCustomerRating({ riderRating: 3 })).toBe(true);
    expect(transactionHasCustomerRating({ rating: 4 })).toBe(true);
    expect(transactionHasCustomerRating({ feedback: "Great" })).toBe(true);
  });
});
