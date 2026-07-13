import type { GeminiContentPart } from "../ai/gemini-multimodal";
import type { SupportChatMessage, SupportMessageAttachment } from "./support-chat-types";
import { countAttachmentKinds } from "./support-attachment-media";

/** Max user+AI turns sent to Gemini (excludes system messages). */
export const SUPPORT_HISTORY_MAX_TURNS = 28;

export const SUPPORT_CONVERSATION_RULES = [
  "## Conversation memory (required)",
  "- You receive prior turns in order, then the latest user message.",
  "- Read the **entire** thread before replying. Build on what was already said.",
  "- **Never** repeat the same greeting, opener, or full explanation you already gave.",
  "- Reference specifics the user shared (screens, customer names, errors, steps they tried).",
  "- Follow-ups (\"still not working\", \"what about…\") mean **continue** the thread—",
  "  do not restart from zero.",
  "- Vary wording; sound like a helpful business buddy, not a script on repeat.",
  "- If the user thanked you, offer the **next** step—not the same answer again.",
  "- When updating session memory, capture unresolved issues, names, and what was already tried.",
  "",
  "## Response quality (required)",
  "- Prefer practical, step-by-step help over generic advice.",
  "- If a technical issue is reported, answer using this flow:",
  "  1) likely cause in plain language,",
  "  2) exact steps to try now,",
  "  3) what to check after each step.",
  "- Ask at most one focused follow-up question only when a missing detail blocks progress.",
  "- Keep answers concise and specific to the user's screen/context.",
  "- For sales, utang, or kinita questions: **state the exact PHP amount in summary first**, then app steps.",
  "- Speak directly to the owner (ikaw/ka) — personal WRS buddy, not generic support.",
  "- Write every reply in **Taglish** by default unless the user clearly prefers another language.",
  "- Voice commands may arrive as transcribed Taglish/English — interpret intent generously.",
  "- When the knowledge includes **In-app video tutorials**, cite matching titles and how to open them",
  "  (Tutorial videos panel or /dashboard?tutorial=id) — do not invent video names.",
].join("\n");

export type GeminiChatContent = {
  role: "user" | "model";
  parts: GeminiContentPart[];
};

function dialogueTurns(history: SupportChatMessage[]): SupportChatMessage[] {
  return history.filter((m) => m.role === "user" || m.role === "ai");
}

/**
 * Builds multi-turn Gemini contents so the model sees real conversation structure.
 * @param {object} input History and final user parts.
 * @param {SupportChatMessage[]} input.history Full message list including latest user turn.
 * @param {GeminiContentPart[]} input.finalUserParts Latest user message (text + images).
 * @return {GeminiChatContent[]} Gemini `contents` array.
 */
export function buildSupportGeminiContents(input: {
  history: SupportChatMessage[];
  finalUserParts: GeminiContentPart[];
}): GeminiChatContent[] {
  const turns = dialogueTurns(input.history).slice(-SUPPORT_HISTORY_MAX_TURNS);
  const contents: GeminiChatContent[] = [];

  for (let i = 0; i < turns.length - 1; i++) {
    const m = turns[i];
    contents.push({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.text }],
    });
  }

  contents.push({ role: "user", parts: input.finalUserParts });
  return contents;
}

export function buildFinalUserParts(
  userText: string,
  attachmentNote: string,
  imageParts: GeminiContentPart[],
): GeminiContentPart[] {
  const text = `${userText}${attachmentNote}`.trim();
  return text ? [{ text }, ...imageParts] : imageParts;
}

export function buildAttachmentNote(
  attachments: SupportMessageAttachment[],
): string {
  const { images, videos } = countAttachmentKinds(attachments);
  if (images <= 0 && videos <= 0) return "";

  const parts: string[] = [];
  if (images > 0) {
    parts.push(
      `${images} image(s): analyze UI/screens, error messages, receipts, containers, or documents`,
    );
  }
  if (videos > 0) {
    parts.push(
      `${videos} video(s): watch the recording, note on-screen actions, errors, and workflow steps`,
    );
  }

  return (
    `\n\nThe user attached media in this message. ${parts.join("; ")}. Relate findings ` +
    "to Smart Refill or water-station operations. If blurry, too long, or off-topic, ask for a " +
    "shorter clip or clearer photo—do not suggest live human support unless they ask."
  );
}

/**
 * Distinct user→AI pairs for cross-session learning when a chat ends.
 * @param {SupportChatMessage[]} messages Session messages in order.
 * @param {number} maxPairs Max pairs to return.
 * @return {object[]} Learnable question/answer pairs.
 */
export function extractLearnablePairs(
  messages: SupportChatMessage[],
  maxPairs = 4,
): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  const dialogue = dialogueTurns(messages);
  for (let i = 0; i < dialogue.length - 1; i++) {
    const a = dialogue[i];
    const b = dialogue[i + 1];
    if (a.role !== "user" || b.role !== "ai") continue;
    const question = a.text.trim();
    const answer = b.text.trim();
    if (question.length < 12 || answer.length < 24) continue;
    const dup = pairs.some(
      (p) => p.question.toLowerCase() === question.toLowerCase(),
    );
    if (!dup) pairs.push({ question, answer });
  }
  return pairs.slice(-maxPairs);
}

export function trimSessionSummary(summary: string | undefined): string | undefined {
  const s = (summary || "").trim();
  if (!s) return undefined;
  return s.length > 900 ? `${s.slice(0, 897)}…` : s;
}
