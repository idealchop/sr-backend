import type { Response } from "express";
import { SubscriptionService } from "../services/subscriptions/subscription-service";
import {
  computeDatesView,
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "../services/subscriptions/subscription-effective";

export function isScalePlanCode(planCode: string | undefined): boolean {
  const code = String(planCode || "starter").toLowerCase();
  return code.includes("scale") || code.includes("enterprise");
}

/** SC-* platform features: Scale / Enterprise (including 15-day Scale trial). */
export function resolveScalePlatformAccess(sub: {
  planCode?: string;
  status?: string;
  billingCycle?: string;
  isExpired?: boolean;
}): boolean {
  if (sub.isExpired) return false;
  if (!isScalePlanCode(sub.planCode)) return false;

  const status = String(sub.status || "").toLowerCase();
  const cycle = String(sub.billingCycle || "").toLowerCase();
  if (cycle === "trial" || status === "trial") {
    return true;
  }
  return status === "active" || status === "grace_period";
}

/** Owner Alerts (push, utang reminders, morning briefs) — Scale / Enterprise / Scale trial. */
export async function isBusinessEligibleForStationAlerts(
  businessId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await fetchRecentSubscriptionRows(businessId);
  const effective = pickEffectiveEntitling(rows, now);
  if (!effective) return false;
  const view = computeDatesView(effective.data, now);
  return resolveScalePlatformAccess({
    planCode: String(effective.data.planCode || ""),
    status: view.status,
    billingCycle: String(effective.data.billingCycle || ""),
    isExpired: view.isExpired,
  });
}

export async function assertScalePlatformAccess(
  businessId: string,
  res: Response,
): Promise<boolean> {
  const sub = await SubscriptionService.getSubscriptionStatus(businessId);
  if (resolveScalePlatformAccess(sub)) return true;
  res.status(403).json({
    error: "SCALE_PLAN_REQUIRED",
    message: "This feature requires a Scale or Enterprise plan.",
  });
  return false;
}
