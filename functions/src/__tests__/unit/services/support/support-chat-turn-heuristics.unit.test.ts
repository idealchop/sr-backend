import { describe, expect, it } from "vitest";
import {
  applySupportTurnHeuristics,
  DISSATISFIED_PATTERNS,
  HUMAN_ESCALATION_PATTERNS,
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
  it("does not suggest human for Filipino negation with attachments", () => {
    const turn = applySupportTurnHeuristics(
      baseTurn({ suggestHuman: true }),
      "Hindi ko ma-open ang delivery page, eto screenshot",
      true,
    );
    expect(turn.suggestHuman).toBe(false);
    expect(turn.detectedHumanRequest).toBe(false);
    expect(DISSATISFIED_PATTERNS.test("Hindi ko ma-open ang delivery page")).toBe(false);
  });

  it("clears Gemini suggestHuman when message has attachments", () => {
    const turn = applySupportTurnHeuristics(
      baseTurn({ suggestHuman: true, detectedHumanRequest: false }),
      "What is this error on my screen?",
      true,
    );
    expect(turn.suggestHuman).toBe(false);
  });

  it("escalates only on explicit human request", () => {
    const text = "Please talk to a human agent";
    expect(HUMAN_ESCALATION_PATTERNS.test(text)).toBe(true);
    const turn = applySupportTurnHeuristics(baseTurn(), text, true);
    expect(turn.detectedHumanRequest).toBe(true);
    expect(turn.suggestHuman).toBe(true);
  });

  it("does not treat bare 'no' in a sentence as dissatisfaction", () => {
    expect(DISSATISFIED_PATTERNS.test("I have no idea what this button does")).toBe(false);
    const turn = applySupportTurnHeuristics(
      baseTurn(),
      "I have no idea what this button does",
      false,
    );
    expect(turn.detectedDissatisfied).toBe(false);
    expect(turn.suggestHuman).toBe(false);
  });
});
