import { describe, expect, it } from "vitest";
import {
  buildOwnerUsageGoalsContext,
  normalizeUsageGoalIds,
} from "../../../utils/usage-goals";

describe("usage-goals", () => {
  it("normalizes and dedupes goal ids", () => {
    expect(normalizeUsageGoalIds(["sales", "SALES", "unknown", "delivery"])).toEqual([
      "sales",
      "delivery",
    ]);
    expect(normalizeUsageGoalIds(null)).toEqual([]);
  });

  it("builds labels, descriptions, and ranked intel tools", () => {
    const customersCtx = buildOwnerUsageGoalsContext(["customers"]);
    expect(customersCtx.recommendedIntelTools[0]).toBe("retention_pulse");
    expect(customersCtx.recommendedIntelTools).toContain("collections_pulse");

    const ctx = buildOwnerUsageGoalsContext(["customers", "sales", "sales"]);
    expect(ctx.ids).toEqual(["customers", "sales"]);
    expect(ctx.labels).toEqual(["Customer management", "Sales tracking"]);
    expect(ctx.descriptions[0]).toContain("suki");
    expect(ctx.recommendedIntelTools).toContain("retention_pulse");
    expect(ctx.recommendedIntelTools).toContain("collections_pulse");
  });

  it("returns empty recommendations when no goals", () => {
    const ctx = buildOwnerUsageGoalsContext([]);
    expect(ctx.recommendedIntelTools).toEqual([]);
  });
});
