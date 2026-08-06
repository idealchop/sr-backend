import { describe, expect, it } from "vitest";
import { MAX_AUTO_AI_TOOLS_PER_BUSINESS_PER_DAY } from "../../../../services/ai/auto-ai-tool-budget";

describe("auto-ai-tool-budget", () => {
  it("caps scheduled auto AI tools at 2 per business per day", () => {
    expect(MAX_AUTO_AI_TOOLS_PER_BUSINESS_PER_DAY).toBe(2);
  });
});
