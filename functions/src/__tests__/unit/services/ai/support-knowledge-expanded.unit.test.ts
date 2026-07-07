import { describe, expect, it } from "vitest";
import { buildSupportKnowledgeContext } from "../../../../services/ai/support-knowledge-catalog";
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
});
