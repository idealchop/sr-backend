import { describe, expect, it } from "vitest";
import {
  applySupportTurnHeuristics,
  DISSATISFIED_PATTERNS,
  HUMAN_SUPPORT_POINTER_PATTERNS,
} from "../../../../services/support/support-chat-turn-heuristics";
import type { SupportAiTurnResult } from "../../../../services/support/support-chat-types";

function baseTurn(overrides: Partial<SupportAiTurnResult> = {}): SupportAiTurnResult {
  return {
    reply: "Test reply",
    askSatisfaction: true,
    suggestHuman: false,
    suggestResolve: false,
    detectedSatisfied: false,
    detectedDissatisfied: false,
    detectedHumanRequest: false,
    topicOutOfScope: false,
    ...overrides,
  };
}

describe("applySupportTurnHeuristics", () => {
  it("never escalates Buddy to human / Brevo", () => {
    const turn = applySupportTurnHeuristics(
      baseTurn({ suggestHuman: true, detectedHumanRequest: true }),
      "Please talk to a human agent",
    );
    expect(HUMAN_SUPPORT_POINTER_PATTERNS.test("Please talk to a human agent")).toBe(true);
    expect(turn.suggestHuman).toBe(false);
    expect(turn.detectedHumanRequest).toBe(false);
  });

  it("clears Gemini suggestHuman flags", () => {
    const turn = applySupportTurnHeuristics(
      baseTurn({ suggestHuman: true, detectedHumanRequest: true }),
      "What is this error on my screen?",
    );
    expect(turn.suggestHuman).toBe(false);
    expect(turn.detectedHumanRequest).toBe(false);
  });

  it("does not treat bare 'no' in a sentence as dissatisfaction", () => {
    expect(DISSATISFIED_PATTERNS.test("I have no idea what this button does")).toBe(false);
    const turn = applySupportTurnHeuristics(
      baseTurn(),
      "I have no idea what this button does",
    );
    expect(turn.detectedDissatisfied).toBe(false);
    expect(turn.suggestHuman).toBe(false);
  });
});
