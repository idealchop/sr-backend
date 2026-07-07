import { describe, expect, it } from "vitest";
import { buildDeliveryChatPushCopy } from "../../../../services/notifications/delivery-messenger-chat-push-service";
import { META_POSTBACK_DELIVERY_CHAT } from "../../../../services/meta/community-order-template";

describe("delivery-messenger-chat-push-service", () => {
  it("builds FCM copy with customer and reference", () => {
    const copy = buildDeliveryChatPushCopy({
      customerName: "Maria",
      referenceId: "TX-1042",
      preview: "Saan na po ang rider?",
    });
    expect(copy.title).toContain("delivery chat");
    expect(copy.body).toContain("Maria");
    expect(copy.body).toContain("TX-1042");
    expect(copy.body).toContain("Saan na po");
  });

  it("exports delivery chat postback payload", () => {
    expect(META_POSTBACK_DELIVERY_CHAT).toBe("DELIVERY_CHAT");
  });
});
