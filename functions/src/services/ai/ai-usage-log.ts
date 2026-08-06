/**
 * Structured AI usage logs for cost oversight (Cloud Logging → Monitoring).
 * Never log API keys or full prompts.
 */

import { logger } from "../observability/logging/logger";

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export function extractGeminiUsageMetadata(
  data: unknown,
): GeminiUsageMetadata | undefined {
  if (!data || typeof data !== "object") return undefined;
  const usage = (data as { usageMetadata?: Record<string, unknown> }).usageMetadata;
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokenCount =
    typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
  const candidatesTokenCount =
    typeof usage.candidatesTokenCount === "number" ?
      usage.candidatesTokenCount :
      undefined;
  const totalTokenCount =
    typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined;
  if (
    promptTokenCount === undefined &&
    candidatesTokenCount === undefined &&
    totalTokenCount === undefined
  ) {
    return undefined;
  }
  return { promptTokenCount, candidatesTokenCount, totalTokenCount };
}

export function logAiUsage(input: {
  provider: "gemini" | "imagen";
  operation: string;
  model: string;
  ok: boolean;
  usage?: GeminiUsageMetadata;
  status?: number;
  extra?: Record<string, unknown>;
}): void {
  logger.info("ai_usage", {
    app: "smartrefill",
    provider: input.provider,
    operation: input.operation,
    model: input.model,
    ok: input.ok,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.usage ?? {}),
    ...(input.extra ?? {}),
  });
}
