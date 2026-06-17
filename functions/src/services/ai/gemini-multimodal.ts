import { logger } from "../observability/logging/logger";
import { getGeminiApiKey, getGeminiModel } from "./gemini-config";

export type GeminiContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

// eslint-disable-next-line valid-jsdoc
/**
 * Gemini JSON response with optional image inputs (inline base64).
 */
export type GeminiChatTurn = {
  role: "user" | "model";
  parts: GeminiContentPart[];
};

export async function geminiGenerateJsonWithParts<T>(input: {
  system: string;
  parts: GeminiContentPart[];
  fallback: T;
  maxOutputTokens?: number;
  temperature?: number;
  /** Multi-turn thread; when set, `parts` is ignored for contents (use final turn there). */
  contents?: GeminiChatTurn[];
}): Promise<T> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    logger.warn("geminiGenerateJsonWithParts: no API key");
    return input.fallback;
  }

  const model = getGeminiModel();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
    `:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents?.length ?
          input.contents :
          [{ role: "user", parts: input.parts }],
        generationConfig: {
          temperature: input.temperature ?? 0.35,
          maxOutputTokens: input.maxOutputTokens ?? 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error("geminiGenerateJsonWithParts HTTP error", {
        status: res.status,
        model,
        errText,
      });
      return input.fallback;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return input.fallback;

    return JSON.parse(text) as T;
  } catch (e) {
    logger.error("geminiGenerateJsonWithParts failed", { model, error: e });
    return input.fallback;
  }
}
