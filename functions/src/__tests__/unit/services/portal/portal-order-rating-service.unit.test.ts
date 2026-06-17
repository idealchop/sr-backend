import { describe, expect, it } from "vitest";
import {
  portalPayloadHasRatingInput,
} from "../../../../services/portal/portal-order-rating-service";

describe("portalPayloadHasRatingInput", () => {
  it("returns false when no ratings or feedback", () => {
    expect(portalPayloadHasRatingInput({})).toBe(false);
    expect(
      portalPayloadHasRatingInput({ serviceRating: 0, feedback: "   " }),
    ).toBe(false);
  });

  it("returns true when any rating or feedback is present", () => {
    expect(portalPayloadHasRatingInput({ serviceRating: 4 })).toBe(true);
    expect(portalPayloadHasRatingInput({ riderRating: 3 })).toBe(true);
    expect(portalPayloadHasRatingInput({ feedback: "Great service" })).toBe(
      true,
    );
  });
});
