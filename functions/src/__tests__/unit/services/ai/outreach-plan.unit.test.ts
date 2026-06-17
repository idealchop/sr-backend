import { describe, expect, it } from "vitest";
import { normalizeOutreachPlan } from "../../../../services/ai/ai-tool-run-service";

describe("normalizeOutreachPlan", () => {
  const allowed = new Set(["ana reyes", "ben cruz"]);

  it("keeps rows that match dormant sample names only", () => {
    const rows = normalizeOutreachPlan(
      [
        {
          name: "Ana Reyes",
          priority: "high",
          reason: "14d silent",
          suggestedMessage: "Hi Ana, miss na namin kayo — refill bukas?",
        },
        {
          name: "Unknown Person",
          priority: "high",
          reason: "fake",
          suggestedMessage: "Should not appear",
        },
      ],
      allowed,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ana Reyes");
    expect(rows[0].suggestedMessage).toContain("Ana");
  });

  it("truncates suggestedMessage to 280 chars and drops empty messages", () => {
    const long = "x".repeat(300);
    const rows = normalizeOutreachPlan(
      [
        { name: "Ben Cruz", priority: "low", reason: "", suggestedMessage: long },
        { name: "Ana Reyes", priority: "medium", reason: "ok", suggestedMessage: "   " },
      ],
      allowed,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ben Cruz");
    expect(rows[0].suggestedMessage).toHaveLength(280);
  });

  it("sorts by priority high first", () => {
    const rows = normalizeOutreachPlan(
      [
        {
          name: "Ben Cruz",
          priority: "low",
          reason: "a",
          suggestedMessage: "Ben msg",
        },
        {
          name: "Ana Reyes",
          priority: "high",
          reason: "b",
          suggestedMessage: "Ana msg",
        },
      ],
      allowed,
    );
    expect(rows[0].priority).toBe("high");
    expect(rows[1].priority).toBe("low");
  });
});
