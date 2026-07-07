import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/meta/community-order-wizard-service", () => ({
  handleCommunityMessengerPostback: vi.fn(async () => false),
  replyCommunityWelcomeWithChoice: vi.fn(async () => undefined),
}));

vi.mock("../../../../services/meta/community-order-intake-service", () => ({
  handleCommunityInboundText: vi.fn(async () => undefined),
  handleCommunityInboundLocation: vi.fn(async () => undefined),
}));

import {
  handleCommunityInboundLocation,
  handleCommunityInboundText,
} from "../../../../services/meta/community-order-intake-service";
import {
  handleCommunityMessengerPostback,
  replyCommunityWelcomeWithChoice,
} from "../../../../services/meta/community-order-wizard-service";
import { processViberCommunityWebhook } from "../../../../services/meta/viber-community-webhook-processor";
import {
  META_POSTBACK_ORDER_CONFIRM_YES,
} from "../../../../services/meta/community-order-template";

describe("viber community webhook processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("welcomes on conversation_started", async () => {
    await processViberCommunityWebhook({
      event: "conversation_started",
      sender: { id: "viber-1" },
    });

    expect(replyCommunityWelcomeWithChoice).toHaveBeenCalledWith({
      sourceChannel: "community_viber",
      contactId: "viber-1",
    });
  });

  it("routes text messages through intake", async () => {
    await processViberCommunityWebhook({
      event: "message",
      message_token: 99,
      sender: { id: "viber-2" },
      message: { type: "text", text: "2 galon tubig" },
    });

    expect(handleCommunityMessengerPostback).toHaveBeenCalled();
    expect(handleCommunityInboundText).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: { sourceChannel: "community_viber", contactId: "viber-2" },
        text: "2 galon tubig",
        metaMessageId: "99",
      }),
    );
  });

  it("treats keyboard reply payload as postback", async () => {
    vi.mocked(handleCommunityMessengerPostback).mockResolvedValueOnce(true);

    await processViberCommunityWebhook({
      event: "message",
      sender: { id: "viber-3" },
      message: { type: "text", text: META_POSTBACK_ORDER_CONFIRM_YES },
    });

    expect(handleCommunityMessengerPostback).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: META_POSTBACK_ORDER_CONFIRM_YES,
      }),
    );
    expect(handleCommunityInboundText).not.toHaveBeenCalled();
  });

  it("routes location messages", async () => {
    await processViberCommunityWebhook({
      event: "message",
      sender: { id: "viber-4" },
      message: {
        type: "location",
        location: { lat: 14.55, lon: 121.02 },
      },
    });

    expect(handleCommunityInboundLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: { sourceChannel: "community_viber", contactId: "viber-4" },
        latitude: 14.55,
        longitude: 121.02,
      }),
    );
  });
});
