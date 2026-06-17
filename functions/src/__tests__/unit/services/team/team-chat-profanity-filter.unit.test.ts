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
