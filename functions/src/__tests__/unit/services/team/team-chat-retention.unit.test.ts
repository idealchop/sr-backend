import { describe, expect, it } from "vitest";
import {
  TEAM_CHAT_RETENTION_DAYS,
  teamChatRetentionCutoffDate,
} from "../../../../services/team/team-chat-retention";

describe("teamChatRetentionCutoffDate", () => {
  it("uses a 7-day rolling window", () => {
    const now = Date.parse("2026-06-02T12:00:00.000Z");
    const cutoff = teamChatRetentionCutoffDate(now);
    expect(TEAM_CHAT_RETENTION_DAYS).toBe(7);
    expect(cutoff.toISOString()).toBe("2026-05-26T12:00:00.000Z");
  });
});
