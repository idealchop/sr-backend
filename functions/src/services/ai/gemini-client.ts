import { logger } from "../observability/logging/logger";
import { getGeminiApiKey, getGeminiModel } from "./gemini-config";

export { getGeminiApiKey, getGeminiModel } from "./gemini-config";

export async function geminiGenerateJson<T>(input: {
  system: string;
  user: string;
  fallback: T;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<T> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    logger.warn("geminiGenerateJson: no API key, using fallback");
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
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          temperature: input.temperature ?? 0.35,
          maxOutputTokens: input.maxOutputTokens ?? 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error("geminiGenerateJson HTTP error", {
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
    logger.error("geminiGenerateJson failed", { model, error: e });
    return input.fallback;
  }
}
