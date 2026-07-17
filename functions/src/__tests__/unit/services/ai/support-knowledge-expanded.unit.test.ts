import { describe, expect, it } from "vitest";
import {
  buildSupportKnowledgeContext,
  findHighConfidenceKnowledgeHit,
  SUPPORT_FAQ_ENTRIES,
} from "../../../../services/ai/support-knowledge-catalog";
import { SUPPORT_AI_PERSONA } from "../../../../services/ai/support-persona-roles";

describe("River AI expanded knowledge", () => {
  it("includes equipment and water science blocks", () => {
    const ctx = buildSupportKnowledgeContext([], "RO membrane TDS");
    expect(ctx).toContain("Equipment & maintenance");
    expect(ctx).toContain("Water science");
    expect(ctx).toContain("River AI knowledge manifest");
  });

  it("defines seven-role persona", () => {
    expect(SUPPORT_AI_PERSONA).toContain("Technician");
    expect(SUPPORT_AI_PERSONA).toContain("Water expert");
    expect(SUPPORT_AI_PERSONA).toContain("Staff / Assistant");
    expect(SUPPORT_AI_PERSONA).toContain("Buddy / Companion");
  });

  it("finds high-confidence FAQ hits for clear how-to questions", () => {
    const hit = findHighConfidenceKnowledgeHit(
      SUPPORT_FAQ_ENTRIES,
      "How do I create a delivery?",
    );
    expect(hit).not.toBeNull();
    expect(hit?.entry.id).toBe("add-delivery");
    expect(hit?.score).toBeGreaterThanOrEqual(14);
  });

  it("does not treat weak token overlap as a cache hit", () => {
    const hit = findHighConfidenceKnowledgeHit(
      SUPPORT_FAQ_ENTRIES,
      "random unrelated question about cats",
    );
    expect(hit).toBeNull();
  });
});
