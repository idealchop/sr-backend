import type { Response } from "express";
import { SubscriptionService } from "../services/subscriptions/subscription-service";

export function isScalePlanCode(planCode: string | undefined): boolean {
  const code = String(planCode || "starter").toLowerCase();
  return code.includes("scale") || code.includes("enterprise");
}

/** SC-* platform features: Scale / Enterprise (including 7-day Scale trial). */
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
