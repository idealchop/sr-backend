import { describe, expect, it } from "vitest";
import {
  enrichStructuredReply,
  normalizeStructuredReply,
  structuredReplyToPlainText,
} from "../../../../services/support/support-structured-reply";

describe("support-structured-reply", () => {
  it("normalizes structured card payload from Gemini JSON", () => {
    const structured = normalizeStructuredReply({
      sectionLabel: "SAGOT",
      summary: "Main answer in Taglish.",
      badges: [{ label: "Operations", tone: "info" }],
      highlights: [
        {
          title: "Tip",
          body: "Check Transactions tab.",
          variant: "tip",
        },
      ],
      steps: [
        {
          title: "Open Add Delivery",
          body: "Pick customer and date.",
          priority: "high",
          tags: ["Transactions"],
        },
      ],
      evidence: "Extra detail here.",
    });

    expect(structured?.sectionLabel).toBe("SAGOT");
    expect(structured?.badges).toHaveLength(1);
    expect(structured?.highlights).toHaveLength(1);
    expect(structured?.steps).toHaveLength(1);
    expect(structured?.evidence).toBe("Extra detail here.");
  });

  it("flattens structured cards to plain text for learnings", () => {
    const text = structuredReplyToPlainText({
      sectionLabel: "SAGOT",
      summary: "Summary line.",
      highlights: [{ title: "Heads up", body: "Do this first.", variant: "tip" }],
      steps: [{ title: "Step one", body: "Details", priority: "high" }],
      evidence: "More context.",
    });

    expect(text).toContain("Summary line.");
    expect(text).toContain("Heads up: Do this first.");
    expect(text).toContain("1. Step one");
    expect(text).toContain("More context.");
  });

  it("splits inline numbered steps from summary into steps array", () => {
    const structured = enrichStructuredReply({
      sectionLabel: "SAGOT",
      summary:
        "Madali lang ito: 1. Pumunta sa **Transactions**. 2. I-click ang **Add Delivery**. 3. I-save.",
    });

    expect(structured.summary).toContain("Madali lang");
    expect(structured.steps).toHaveLength(3);
    expect(structured.steps?.[0].title).toContain("Transactions");
  });
});
