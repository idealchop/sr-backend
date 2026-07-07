import { FieldValue, Timestamp } from "../../config/firebase-admin";
import { logAuditEvent } from "../observability/logging/logger";
import {
  fetchRecentSubscriptionRows,
  parseSubscriptionTimestamp,
} from "./subscription-effective";

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

function isScaleTrialRow(data: Record<string, unknown>): boolean {
  return (
    String(data.planCode || "").toLowerCase() === "scale" &&
    String(data.billingCycle || "") === "trial"
  );
}

function trialBudgetExpiresAt(data: Record<string, unknown>): Date | null {
  const meta = data.metadata as Record<string, unknown> | undefined;
  if (meta?.trialBudgetExpiresAt) {
    return parseSubscriptionTimestamp(meta.trialBudgetExpiresAt);
  }
  const dates = data.dates as { expiresAt?: unknown } | undefined;
  if (dates?.expiresAt) {
    return parseSubscriptionTimestamp(dates.expiresAt);
  }
  return null;
}

function trialState(data: Record<string, unknown>): string {
  const meta = data.metadata as Record<string, unknown> | undefined;
  return String(meta?.trialState || "running").toLowerCase();
}

function findLatestTrialRow(rows: Awaited<ReturnType<typeof fetchRecentSubscriptionRows>>) {
  return rows.find((r) => isScaleTrialRow(r.data)) ?? null;
}

export class TrialLifecycleService {
  /**
   * Records trial budget metadata on new trial rows.
   */
  static withTrialBudgetMetadata(
    expiresAt: Date,
    base: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const meta =
      base.metadata && typeof base.metadata === "object" ?
        { ...(base.metadata as Record<string, unknown>) } :
        {};
    return {
      ...base,
      metadata: {
        ...meta,
        trialState: "running",
        trialBudgetExpiresAt: expiresAt.toISOString(),
        trialBudgetMs: TRIAL_MS,
      },
    };
  }

  /**
   * Pause an in-progress Scale trial (MIA). Remaining time can be resumed later
   * until the original 7-day budget is consumed.
   */
  static async pauseTrialIfRunning(
    businessId: string,
    userId: string,
  ): Promise<{ paused: boolean; remainingMs?: number }> {
    const rows = await fetchRecentSubscriptionRows(businessId);
    const trial = findLatestTrialRow(rows);
    if (!trial) return { paused: false };

    const data = trial.data;
    if (trialState(data) === "paused") return { paused: false };
    if (String(data.status || "") === "superseded") return { paused: false };

    const now = new Date();
    const dates = data.dates as { expiresAt?: unknown } | undefined;
    const expiresAt = parseSubscriptionTimestamp(dates?.expiresAt);
    const budgetEnd = trialBudgetExpiresAt(data);
    if (!budgetEnd || now >= budgetEnd) return { paused: false };
    if (now >= expiresAt) return { paused: false };

    const remainingMs = Math.min(
      expiresAt.getTime() - now.getTime(),
      budgetEnd.getTime() - now.getTime(),
    );
    if (remainingMs <= 0) return { paused: false };

    const meta = (data.metadata as Record<string, unknown> | undefined) ?? {};
    await trial.ref.update({
      "metadata.trialState": "paused",
      "metadata.trialRemainingMs": remainingMs,
      "dates.trialPausedAt": Timestamp.fromDate(now),
      "updatedAt": FieldValue.serverTimestamp(),
    });

    logAuditEvent("TRIAL_PAUSED", {
      businessId,
      userId,
      subscriptionId: trial.id,
      remainingMs,
    });

    return { paused: true, remainingMs };
  }

  /**
   * Resume a paused trial when the owner returns before the 7-day budget ends.
   */
  static async resumeTrialIfPaused(businessId: string): Promise<boolean> {
    const rows = await fetchRecentSubscriptionRows(businessId);
    const trial = findLatestTrialRow(rows);
    if (!trial) return false;
    if (trialState(trial.data) !== "paused") return false;
    if (String(trial.data.status || "") === "superseded") return false;

    const now = new Date();
    const budgetEnd = trialBudgetExpiresAt(trial.data);
    if (!budgetEnd || now >= budgetEnd) return false;

    const meta = trial.data.metadata as Record<string, unknown> | undefined;
    const remainingMs = Math.max(
      0,
      Number(meta?.trialRemainingMs || 0),
    );
    if (remainingMs <= 0) return false;

    const newExpires = new Date(
      Math.min(now.getTime() + remainingMs, budgetEnd.getTime()),
    );

    await trial.ref.update({
      "status": "active",
      "metadata.trialState": "running",
      "metadata.trialRemainingMs": FieldValue.delete(),
      "dates.expiresAt": Timestamp.fromDate(newExpires),
      "dates.renewalAt": Timestamp.fromDate(newExpires),
      "dates.trialResumedAt": Timestamp.fromDate(now),
      "dates.trialPausedAt": FieldValue.delete(),
      "updatedAt": FieldValue.serverTimestamp(),
    });

    logAuditEvent("TRIAL_RESUMED", {
      businessId,
      subscriptionId: trial.id,
      expiresAt: newExpires.toISOString(),
    });

    return true;
  }

  /**
   * True when this business already consumed or started its one Scale trial.
   */
  static async hasUsedTrialBudget(businessId: string): Promise<boolean> {
    const rows = await fetchRecentSubscriptionRows(businessId, 48);
    const trial = findLatestTrialRow(rows);
    if (!trial) {
      const audit = await fetchRecentSubscriptionRows(businessId);
      void audit;
      return rows.some((r) => isScaleTrialRow(r.data));
    }
    const budgetEnd = trialBudgetExpiresAt(trial.data);
    if (!budgetEnd) return true;
    if (new Date() >= budgetEnd) return true;
    if (trialState(trial.data) === "paused") {
      const remaining = Number(
        (trial.data.metadata as Record<string, unknown> | undefined)
          ?.trialRemainingMs || 0,
      );
      return remaining <= 0;
    }
    return false;
  }

  /**
   * Paused trial with remaining budget — blocks auto-Starter until budget ends.
   */
  static async hasResumablePausedTrial(businessId: string): Promise<boolean> {
    const rows = await fetchRecentSubscriptionRows(businessId);
    const trial = findLatestTrialRow(rows);
    if (!trial || trialState(trial.data) !== "paused") return false;
    if (String(trial.data.status || "") === "superseded") return false;
    const budgetEnd = trialBudgetExpiresAt(trial.data);
    if (!budgetEnd || new Date() >= budgetEnd) return false;
    const remaining = Number(
      (trial.data.metadata as Record<string, unknown> | undefined)
        ?.trialRemainingMs || 0,
    );
    return remaining > 0;
  }
}
