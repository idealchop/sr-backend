import { describe, expect, it } from "vitest";
import {
  isTeamChatReaction,
  TEAM_CHAT_REACTIONS,
} from "../../../../services/team/team-chat-reactions";

describe("team-chat-reactions", () => {
  it("accepts supported reaction types only", () => {
    for (const type of TEAM_CHAT_REACTIONS) {
      expect(isTeamChatReaction(type)).toBe(true);
    }
    expect(isTeamChatReaction("love")).toBe(false);
    expect(isTeamChatReaction(null)).toBe(false);
  });
});
