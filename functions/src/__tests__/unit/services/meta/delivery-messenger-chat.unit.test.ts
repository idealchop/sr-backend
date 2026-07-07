import { describe, expect, it } from "vitest";
import {
  buildCommunityActiveOrderBlockedMessage,
  buildCommunityCancelNotAvailableAcceptedMessage,
  COMMUNITY_DELIVERY_CHAT_HINT,
} from "../../../../services/meta/community-messenger-copy";
import { parseDeliveryChatCommand } from "../../../../services/meta/delivery-messenger-chat-service";
import { parseTeamMessengerCommand } from "../../../../services/team/team-messenger-intake-service";

describe("delivery chat copy and commands", () => {
  it("parses customer CHAT and CLOSE CHAT", () => {
    expect(parseDeliveryChatCommand("CHAT")).toEqual({ kind: "open" });
    expect(parseDeliveryChatCommand("close chat")).toEqual({ kind: "close" });
    expect(parseDeliveryChatCommand("hello")).toEqual({ kind: "none" });
  });

  it("in-delivery blocked message uses CHAT not cancel or inquiry", () => {
    const msg = buildCommunityActiveOrderBlockedMessage({
      referenceId: "TX-260701-ABCD",
      phase: "in_delivery",
    });
    expect(msg).toContain(COMMUNITY_DELIVERY_CHAT_HINT);
    expect(msg).not.toContain("CANCEL");
    expect(msg).not.toContain("Inquiry / Others");
  });

  it("waiting-station blocked message keeps cancel hint", () => {
    const msg = buildCommunityActiveOrderBlockedMessage({
      referenceId: "CR-ABC12345",
      phase: "waiting_station",
    });
    expect(msg).toContain("CANCEL - {reason}");
    expect(msg).toContain("Inquiry / Others");
  });

  it("builds cancel-not-available message for accepted orders", () => {
    const msg = buildCommunityCancelNotAvailableAcceptedMessage({
      referenceId: "TX-1042",
    });
    expect(msg).toContain("TX-1042");
    expect(msg).toContain("CHAT");
    expect(msg).not.toContain("CANCEL -");
  });

  it("parses owner CHAT CUST and CHAT TX ref for delivery chat", () => {
    expect(parseTeamMessengerCommand("CHAT CUST TX-1042")).toEqual({
      kind: "delivery_chat_open",
      target: "TX-1042",
    });
    expect(parseTeamMessengerCommand("CHAT TO CR-ABC123")).toEqual({
      kind: "delivery_chat_open",
      target: "CR-ABC123",
    });
    expect(parseTeamMessengerCommand("CHAT TX-1042")).toEqual({
      kind: "delivery_chat_open",
      target: "TX-1042",
    });
    expect(parseTeamMessengerCommand("CHAT 1")).toEqual({
      kind: "chat_open",
      target: "1",
    });
    expect(parseTeamMessengerCommand("CHAT Juan")).toEqual({
      kind: "chat_open",
      target: "Juan",
    });
  });
});
