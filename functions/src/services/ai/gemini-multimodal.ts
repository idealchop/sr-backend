import { logger } from "../observability/logging/logger";
import { getGeminiApiKey, getGeminiModel } from "./gemini-config";
import {
  extractGeminiUsageMetadata,
  logAiUsage,
} from "./ai-usage-log";
import { isAiOperationAllowedDuringMaintenance } from "./ai-maintenance";

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
  operation?: string;
}): Promise<T> {
  const operation = input.operation || "generateJsonWithParts";
  if (!isAiOperationAllowedDuringMaintenance(operation)) {
    logger.warn("geminiGenerateJsonWithParts blocked — AI under maintenance", {
      operation,
      remark: "under_maintenance",
    });
    return input.fallback;
  }

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
      logAiUsage({
        provider: "gemini",
        operation,
        model,
        ok: false,
        status: res.status,
      });
      logger.error("geminiGenerateJsonWithParts HTTP error", {
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
    logger.error("geminiGenerateJsonWithParts failed", { model, error: e });
    return input.fallback;
  }
}
