import type { SupportAiTurnResult } from "./support-chat-types";

export const HUMAN_ESCALATION_PATTERNS = new RegExp(
  "\\b(human|agent|person|real support|live support|helpdesk|talk to someone|speak to|" +
  "representative|tawag|tao|tulong ng tao)\\b",
  "i",
);

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
 * Rule-based overrides after Gemini JSON. Auto-escalation to Brevo should only happen
 * when the user explicitly asks for a human — not when they send screenshots or use "hindi/no"
 * in normal sentences.
 * @param {SupportAiTurnResult} parsed Parsed Gemini turn.
 * @param {string} userText Latest user message text.
 * @param {boolean} hasAttachments Whether the turn includes image/video attachments.
 * @return {SupportAiTurnResult} Turn with heuristic flags applied.
 */
export function applySupportTurnHeuristics(
  parsed: SupportAiTurnResult,
  userText: string,
  hasAttachments: boolean,
): SupportAiTurnResult {
  const out: SupportAiTurnResult = { ...parsed };

  if (HUMAN_ESCALATION_PATTERNS.test(userText)) {
    out.detectedHumanRequest = true;
    out.suggestHuman = true;
    out.askSatisfaction = false;
    return out;
  }

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

  if (hasAttachments && !out.detectedHumanRequest) {
    out.suggestHuman = false;
    out.detectedHumanRequest = false;
  }

  return out;
}
