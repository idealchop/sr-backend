import { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { logger } from "../observability/logging/logger";

export class AiToolQuotaExceededError extends Error {
  readonly code = "AI_QUOTA_EXCEEDED" as const;
  constructor(
    readonly used: number,
    readonly max: number,
  ) {
    super(`AI tool monthly quota exceeded (${used}/${max})`);
    this.name = "AiToolQuotaExceededError";
  }
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Counts `ai_tool_runs` created this UTC month for the business.
 */
export async function countAiToolRunsThisMonth(
  businessId: string,
  now = new Date(),
): Promise<number> {
  const start = Timestamp.fromDate(startOfUtcMonth(now));
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("ai_tool_runs")
    .where("createdAt", ">=", start)
    .select()
    .get();
  return snap.size;
}

/**
 * Enforces plan `aiToolsMonthlyMax` for interactive (non-scheduled) tool runs.
 * Unlimited when max is null. Scheduled auto runs skip this gate (budgeted separately).
 */
export async function assertAiToolMonthlyQuota(
  businessId: string,
  opts: { scheduledAuto?: boolean; now?: Date } = {},
): Promise<void> {
  if (opts.scheduledAuto) return;

  let max: number | null | undefined;
  try {
    const status = await SubscriptionService.getSubscriptionStatus(businessId);
    max =
      status?.limitations &&
      typeof status.limitations === "object" &&
      "aiToolsMonthlyMax" in status.limitations ?
        (status.limitations as { aiToolsMonthlyMax?: number | null }).aiToolsMonthlyMax :
        null;
  } catch (e) {
    logger.warn("assertAiToolMonthlyQuota skipped — subscription lookup failed", {
      businessId,
      error: e,
    });
    return;
  }

  if (max === null || max === undefined) return;
  if (!(typeof max === "number") || !Number.isFinite(max) || max < 0) return;

  const used = await countAiToolRunsThisMonth(businessId, opts.now);
  if (used >= max) {
    logger.warn("ai_tool_quota_exceeded", { businessId, used, max });
    throw new AiToolQuotaExceededError(used, max);
  }
}

/** Alias for non-tool Gemini POSTs (scans, imports, duplicates AI, week, parse-order). */
export async function assertInteractiveAiQuota(
  businessId: string,
  now?: Date,
): Promise<void> {
  await assertAiToolMonthlyQuota(businessId, { now });
}

/** Map quota errors to HTTP 429. Returns true when handled. */
export function sendAiQuotaExceeded(
  res: Response,
  error: unknown,
): boolean {
  if (!(error instanceof AiToolQuotaExceededError)) return false;
  res.status(429).json({
    error: error.message,
    code: error.code,
    used: error.used,
    max: error.max,
  });
  return true;
}
