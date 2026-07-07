import { describe, expect, it } from "vitest";
import {
  buildCommunityActiveOrderBlockedMessage,
  COMMUNITY_DELIVERY_CHAT_HINT,
} from "../../../../services/meta/community-messenger-copy";
import {
  isContinuingCommunityOrderSession,
} from "../../../../services/meta/community-active-order-guard-service";
import type { CommunityMessengerSession } from "../../../../services/meta/community-messenger-session-service";

describe("community-active-order-guard-service", () => {
  it("treats missing-field session as continuation", () => {
    const session: CommunityMessengerSession = {
      psid: "psid-1",
      sourceChannel: "community_messenger",
      fields: { name: "Ana" },
      rawMessage: "Name: Ana",
      missingFields: ["location", "order"],
    };
    expect(isContinuingCommunityOrderSession(session)).toBe(true);
  });

  it("does not treat empty session as continuation", () => {
    expect(isContinuingCommunityOrderSession(null)).toBe(false);
    expect(
      isContinuingCommunityOrderSession({
        psid: "psid-1",
        sourceChannel: "community_messenger",
        fields: {},
        rawMessage: "",
      }),
    ).toBe(false);
  });

  it("builds waiting-station blocked message with cancel hint", () => {
    const msg = buildCommunityActiveOrderBlockedMessage({
      referenceId: "CR-ABC12345",
      phase: "waiting_station",
    });
    expect(msg).toContain("CR-ABC12345");
    expect(msg).toContain("CANCEL - {reason}");
    expect(msg).toContain("Inquiry / Others");
  });

  it("builds in-delivery blocked message with CHAT hint", () => {
    const msg = buildCommunityActiveOrderBlockedMessage({
      referenceId: "TX-260701-ABCD",
      phase: "in_delivery",
    });
    expect(msg).toContain("TX-260701-ABCD");
    expect(msg).toContain("tracking link");
    expect(msg).toContain(COMMUNITY_DELIVERY_CHAT_HINT);
    expect(msg).not.toContain("CANCEL");
    expect(msg).not.toContain("Inquiry / Others");
  });

  it("builds needs-address blocked message", () => {
    const msg = buildCommunityActiveOrderBlockedMessage({
      referenceId: "CR-NEEDSADDR",
      phase: "needs_address",
    });
    expect(msg).toContain("tamang address");
    expect(msg).toContain("Inquiry / Others");
  });
});
