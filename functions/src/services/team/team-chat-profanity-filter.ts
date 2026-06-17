import { geminiGenerateJson } from "../ai/gemini-client";
import {
  TEAM_CHAT_ENGLISH_PROFANITY,
  TEAM_CHAT_TAGALOG_PROFANITY,
} from "./team-chat-profanity-words";

const ALL_TERMS = [...TEAM_CHAT_ENGLISH_PROFANITY, ...TEAM_CHAT_TAGALOG_PROFANITY]
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);

function leetNormalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@]/g, "a")
    .replace(/[4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7+]/g, "t")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(.)\1{2,}/g, "$1$1");
}

function maskMatch(raw: string): string {
  if (raw.length <= 2) return "**";
  return "*".repeat(raw.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTermPattern(term: string): RegExp {
  const chars = term.split("").map((ch) => {
    if (ch === " ") return "\\s+";
    if (/[a-z0-9]/.test(ch)) {
      const alts: string[] = [escapeRegExp(ch)];
      if (ch === "a") alts.push("@", "4");
      if (ch === "e") alts.push("3");
      if (ch === "i") alts.push("1", "!", "\\|");
      if (ch === "o") alts.push("0");
      if (ch === "s") alts.push("\\$", "5");
      if (ch === "t") alts.push("7", "\\+");
      return `[${alts.join("")}]+`;
    }
    return escapeRegExp(ch);
  });
  return new RegExp(`(^|[^a-z0-9@$])(${chars.join("")})(?=[^a-z0-9@$]|$)`, "gi");
}

const TERM_PATTERNS = ALL_TERMS.map((term) => ({
  term,
  pattern: buildTermPattern(leetNormalize(term)),
}));

export function maskTeamChatProfanityLocal(text: string): string {
  if (!text.trim()) return text;

  let masked = text;
  for (const { pattern } of TERM_PATTERNS) {
    masked = masked.replace(pattern, (_full, prefix: string, match: string) => {
      return `${prefix}${maskMatch(match)}`;
    });
  }
  return masked;
}

export async function maskTeamChatProfanity(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const localMasked = maskTeamChatProfanityLocal(trimmed);
  const ai = await geminiGenerateJson<{ text?: string }>({
    system:
      "You moderate workplace team chat messages in English and Filipino (Tagalog). " +
      "Return JSON only: {\"text\":\"...\"}. Replace profanity, slurs, vulgar insults, " +
      "and obscene Tagalog/English with asterisks the same length as each masked word. " +
      "Preserve emojis, punctuation, spacing, and non-profane words. Do not add commentary.",
    user: `Mask all profanity in this message:\n${trimmed}`,
    fallback: { text: localMasked },
    temperature: 0,
    maxOutputTokens: 512,
  });

  const aiText = typeof ai.text === "string" ? ai.text.trim() : "";
  if (!aiText) return localMasked;
  return maskTeamChatProfanityLocal(aiText);
}
