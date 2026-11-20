import { describe, expect, it } from "vitest";
import {
  buildNewOrderPushCopy,
  submissionTypeNeedsReviewPush,
} from "../../../../services/notifications/new-order-push-service";
import { submissionTypeNeedsOwnerOrderEmail } from "../../../../services/notifications/new-order-owner-email-service";

describe("new-order-push-service", () => {
  it("builds copy for portal orders", () => {
    const copy = buildNewOrderPushCopy(
      "PLACE_ORDER",
      "Maria Santos",
      "TX-260602-ABCD",
    );
    expect(copy.title).toBe("New QR order");
    expect(copy.body).toContain("Maria Santos");
    expect(copy.body).toContain("TX-260602-ABCD");
  });

  it("builds copy for counter walk-in portal orders", () => {
    const copy = buildNewOrderPushCopy(
      "PLACE_ORDER",
      "Juan Dela Cruz",
      "TX-260602-WALK",
      "walkin",
    );
    expect(copy.title).toBe("Counter walk-in");
    expect(copy.body).toContain("checked in at the counter");
  });

  it("builds copy for collection requests", () => {
    const copy = buildNewOrderPushCopy(
      "REQUEST_COLLECTION",
      "Juan",
      "TX-260602-WXYZ",
    );
    expect(copy.title).toBe("Collection request");
    expect(copy.body).toContain("Juan");
  });

  it("skips profile updates and ratings", () => {
    expect(submissionTypeNeedsReviewPush("PROFILE_UPDATE")).toBe(false);
    expect(submissionTypeNeedsReviewPush("PORTAL_TX_RATINGS")).toBe(false);
    expect(submissionTypeNeedsReviewPush("PLACE_ORDER")).toBe(true);
    expect(submissionTypeNeedsReviewPush("PORTAL_PAY_BALANCE")).toBe(true);
  });

  it("emails the owner only for placed online orders", () => {
    expect(submissionTypeNeedsOwnerOrderEmail("PLACE_ORDER")).toBe(true);
    expect(submissionTypeNeedsOwnerOrderEmail("REQUEST_COLLECTION")).toBe(false);
    expect(submissionTypeNeedsOwnerOrderEmail("PROFILE_UPDATE")).toBe(false);
  });
});
