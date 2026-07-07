import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseTeamMessengerCommand } from "../../../../services/team/team-messenger-intake-service";
import { shouldRouteToTeamMessenger } from "../../../../services/team/team-messenger-routing";

vi.mock("../../../../services/team/team-messenger-link-service", () => ({
  TeamMessengerLinkService: {
    resolveLinkedMember: vi.fn(),
  },
}));

import { TeamMessengerLinkService } from "../../../../services/team/team-messenger-link-service";

describe("parseTeamMessengerCommand", () => {
  it("parses team chat commands", () => {
    expect(parseTeamMessengerCommand("CHAT")).toEqual({ kind: "chat_open" });
    expect(parseTeamMessengerCommand("CHAT Juan")).toEqual({
      kind: "chat_open",
      target: "Juan",
    });
    expect(parseTeamMessengerCommand("CLOSE CHAT")).toEqual({ kind: "chat_close" });
    expect(parseTeamMessengerCommand("LINK TMR-7K2M")).toEqual({
      kind: "link",
      code: "TMR-7K2M",
    });
  });
});

describe("shouldRouteToTeamMessenger", () => {
  beforeEach(() => {
    vi.mocked(TeamMessengerLinkService.resolveLinkedMember).mockResolvedValue(null);
  });

  it("routes linked owner PSID", async () => {
    vi.mocked(TeamMessengerLinkService.resolveLinkedMember).mockResolvedValue({
      businessId: "biz1",
      userId: "owner1",
      memberName: "Owner",
      role: "owner",
      stationLabel: "WRS",
      linkedAt: {} as never,
      psid: "psid-owner",
    });

    expect(
      await shouldRouteToTeamMessenger({
        sender: { id: "psid-owner" },
        message: { text: "hello owner" },
      }),
    ).toBe(true);
  });

  it("routes LINK TMR before link", async () => {
    expect(
      await shouldRouteToTeamMessenger({
        sender: { id: "psid-new" },
        message: { text: "LINK TMR-7K2M" },
      }),
    ).toBe(true);
  });
});
