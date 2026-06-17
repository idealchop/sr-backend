import { describe, it, expect } from "vitest";
import {
  buildSupportGeminiContents,
  extractLearnablePairs,
} from "../../../../services/support/support-chat-ai";
import type { SupportChatMessage } from "../../../../services/support/support-chat-types";

function msg(
  role: SupportChatMessage["role"],
  text: string,
): SupportChatMessage {
  return {
    id: role + text.slice(0, 4),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

describe("buildSupportGeminiContents", () => {
  it("maps prior turns to user/model roles and ends with the latest user message", () => {
    const history = [
      msg("user", "Paano mag-add delivery?"),
      msg("ai", "Open Transactions then Add Delivery."),
      msg("user", "Wala yung customer ko sa list"),
    ];
    const contents = buildSupportGeminiContents({
      history,
      finalUserParts: [{ text: "Wala yung customer ko sa list" }],
    });
    expect(contents).toHaveLength(3);
    expect(contents[0]).toEqual({
      role: "user",
      parts: [{ text: "Paano mag-add delivery?" }],
    });
    expect(contents[1].role).toBe("model");
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts[0]).toEqual({ text: "Wala yung customer ko sa list" });
  });

  it("skips system messages in the thread", () => {
    const history = [
      msg("user", "Help"),
      msg("system", "Session started"),
      msg("ai", "Sure—what screen?"),
      msg("user", "Transactions page"),
    ];
    const contents = buildSupportGeminiContents({
      history,
      finalUserParts: [{ text: "Transactions page" }],
    });
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });
});

describe("extractLearnablePairs", () => {
  it("collects distinct user→AI pairs from a thread", () => {
    const messages = [
      msg("user", "How do I invite staff?"),
      msg("ai", "Go to Team Hub and tap Invite, then send the email link."),
      msg("user", "Still cannot see Team Hub"),
      msg("ai", "Team Hub needs Grow plan or higher on a paid subscription."),
    ];
    const pairs = extractLearnablePairs(messages);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toContain("invite staff");
    expect(pairs[1].question).toContain("Team Hub");
  });
});
