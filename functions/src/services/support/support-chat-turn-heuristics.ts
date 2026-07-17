import type { SupportAiTurnResult } from "./support-chat-types";

/** User asked for a person — Buddy only points to separate Profile → Chat support. */
export const HUMAN_SUPPORT_POINTER_PATTERNS = new RegExp(
  "\\b(human|agent|person|real support|live support|helpdesk|talk to someone|speak to|" +
  "representative|tawag|tao|tulong ng tao)\\b",
  "i",
);

/** @deprecated Use HUMAN_SUPPORT_POINTER_PATTERNS — Buddy no longer escalates to Brevo. */
export const HUMAN_ESCALATION_PATTERNS = HUMAN_SUPPORT_POINTER_PATTERNS;

export const SATISFIED_PATTERNS = new RegExp(
  "\\b(yes|yep|thanks|thank you|salamat|solved|resolved|got it|clear|okay|ok|" +
  "helpful|perfect|all good)\\b",
  "i",
);

/** Explicit dissatisfaction — avoid bare "no" / "hindi" (common in Filipino negation). */
export const DISSATISFIED_PATTERNS = new RegExp(
  "\\b(not help(ful|ed)?|not really|not satisfied|doesn'?t work|didn'?t work|" +
  "still broken|wrong answer|useless|hindi nakatulong|hindi helpful|hindi talaga)\\b",
  "i",
);

export const RESOLVE_PATTERNS =
  /\b(close|resolved|done|fixed|all set|mark resolved|issue closed)\b/i;

/**
 * Rule-based overrides after Gemini JSON. Buddy never escalates into Brevo;
 * live helpdesk stays on Profile → Chat support.
 * @param {SupportAiTurnResult} parsed Parsed Gemini turn.
 * @param {string} userText Latest user message text.
 * @return {SupportAiTurnResult} Turn with heuristic flags applied.
 */
export function applySupportTurnHeuristics(
  parsed: SupportAiTurnResult,
  userText: string,
): SupportAiTurnResult {
  const out: SupportAiTurnResult = {
    ...parsed,
    suggestHuman: false,
    detectedHumanRequest: false,
  };

  if (
    SATISFIED_PATTERNS.test(userText) &&
    !DISSATISFIED_PATTERNS.test(userText)
  ) {
    out.detectedSatisfied = true;
  }

  if (DISSATISFIED_PATTERNS.test(userText)) {
    out.detectedDissatisfied = true;
  }

  if (RESOLVE_PATTERNS.test(userText)) {
    out.suggestResolve = true;
  }

  return out;
}
