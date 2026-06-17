/**
 * Gemini model ladder (newest first). Keep in sync with Firebase AI Logic:
 * https://firebase.google.com/docs/ai-logic/models
 */
export const GEMINI_MODEL_LADDER = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

/** Newest stable Gemini Flash on the ladder. */
export const LATEST_GEMINI_MODEL = GEMINI_MODEL_LADDER[0];

/** Production default: one stable release behind {@link LATEST_GEMINI_MODEL}. */
export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL_LADDER[1];

export function getGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.SMARTREFILL_GEMINI_API_KEY ||
    ""
  ).trim();
}

export function getGeminiModel(): string {
  const fromEnv = (
    process.env.GEMINI_MODEL ||
    process.env.SMARTREFILL_GEMINI_MODEL ||
    ""
  ).trim();
  return fromEnv || DEFAULT_GEMINI_MODEL;
}
