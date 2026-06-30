import { describe, expect, it } from "vitest";
import { buildCommunityOfferPushCopy } from "../../../../services/notifications/community-dispatch-offer-push-service";
import { buildCommunityDispatchExhaustedMessage } from "../../../../services/meta/community-messenger-customer-notifier";

describe("community-dispatch-offer-push-service", () => {
  it("builds broadcast push copy", () => {
    const copy = buildCommunityOfferPushCopy({
      customerName: "Ana",
      qty: 3,
      delivery: true,
      referenceId: "CR-TEST123",
      rank: 0,
    });

    expect(copy.title).toContain("respond now");
    expect(copy.body).toContain("first to accept wins");
    expect(copy.body).toContain("Ana");
    expect(copy.body).toContain("3 gal");
    expect(copy.body).toContain("3 min");
  });
});

describe("community customer messages", () => {
  it("builds exhausted message", () => {
    const message = buildCommunityDispatchExhaustedMessage("CR-XYZ");
    expect(message).toContain("CR-XYZ");
    expect(message).toContain("busy");
  });
});
