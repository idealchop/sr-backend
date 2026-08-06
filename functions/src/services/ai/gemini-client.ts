import { logger } from "../observability/logging/logger";
import { getGeminiApiKey, getGeminiModel } from "./gemini-config";
import {
  extractGeminiUsageMetadata,
  logAiUsage,
} from "./ai-usage-log";
import {
  isAiOperationAllowedDuringMaintenance,
  AI_UNDER_MAINTENANCE_MESSAGE,
} from "./ai-maintenance";

export { getGeminiApiKey, getGeminiModel } from "./gemini-config";

export async function geminiGenerateJson<T>(input: {
  system: string;
  user: string;
  fallback: T;
  maxOutputTokens?: number;
  temperature?: number;
  operation?: string;
}): Promise<T> {
  const operation = input.operation || "generateJson";
  if (!isAiOperationAllowedDuringMaintenance(operation)) {
    logger.warn("geminiGenerateJson blocked — AI under maintenance", {
      operation,
      remark: "under_maintenance",
    });
    return input.fallback;
  }

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
      logAiUsage({
        provider: "gemini",
        operation,
        model,
        ok: false,
        status: res.status,
      });
      logger.error("geminiGenerateJson HTTP error", {
        status: res.status,
        model,
        errText,
      });
      return input.fallback;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: Record<string, unknown>;
    };
    const usage = extractGeminiUsageMetadata(data);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      logAiUsage({
        provider: "gemini",
        operation,
        model,
        ok: false,
        usage,
        extra: { reason: "empty_response" },
      });
      return input.fallback;
    }

    logAiUsage({
      provider: "gemini",
      operation,
      model,
      ok: true,
      usage,
    });
    return JSON.parse(text) as T;
  } catch (e) {
    logAiUsage({
      provider: "gemini",
      operation,
      model,
      ok: false,
      extra: { reason: "exception" },
    });
    logger.error("geminiGenerateJson failed", { model, error: e });
    return input.fallback;
  }
}

/** Exported for handlers that want an explicit maintenance string in responses. */
export { AI_UNDER_MAINTENANCE_MESSAGE };
