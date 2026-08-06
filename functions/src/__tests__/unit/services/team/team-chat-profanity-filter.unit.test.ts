import { describe, expect, it } from "vitest";
import { maskTeamChatProfanityLocal } from "../../../../services/team/team-chat-profanity-filter";

describe("maskTeamChatProfanityLocal", () => {
  it("masks common English profanity", () => {
    const result = maskTeamChatProfanityLocal("What the fuck happened?");
    expect(result).not.toContain("fuck");
    expect(result).toContain("*");
  });

  it("masks common Filipino profanity", () => {
    const result = maskTeamChatProfanityLocal("Tangina mo, late na!");
    expect(result.toLowerCase()).not.toContain("tangina");
    expect(result).toContain("*");
  });

  it("preserves clean workplace text", () => {
    const input = "Delivery done ✅ salamat po";
    expect(maskTeamChatProfanityLocal(input)).toBe(input);
  });
});

describe("maskWorkplaceProfanity local-first", () => {
  it("does not call Gemini by default when local heuristic is enough", async () => {
    const { maskWorkplaceProfanity } = await import(
      "../../../../services/team/team-chat-profanity-filter"
    );
    const prev = process.env.TEAM_CHAT_PROFANITY_AI_ESCALATE;
    delete process.env.TEAM_CHAT_PROFANITY_AI_ESCALATE;
    try {
      const masked = await maskWorkplaceProfanity("What the fuck happened?");
      expect(masked.toLowerCase()).not.toContain("fuck");
      const clean = await maskWorkplaceProfanity("Delivery done salamat");
      expect(clean).toBe("Delivery done salamat");
    } finally {
      if (prev === undefined) delete process.env.TEAM_CHAT_PROFANITY_AI_ESCALATE;
      else process.env.TEAM_CHAT_PROFANITY_AI_ESCALATE = prev;
    }
  });
});
