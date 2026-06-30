import type { Response } from "express";
import {
  computeDatesView,
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "../services/subscriptions/subscription-effective";
import { resolveScalePlatformAccess } from "./scale-plan-access";

/**
 * Community Messenger dispatch is limited to Scale, Enterprise, and active Scale trial.
 * Grow and Starter WRS are excluded from nearby search and cannot accept offers.
 */
export function resolveCommunityMessengerWrsPlanAccess(sub: {
  planCode?: string;
  status?: string;
  billingCycle?: string;
  isExpired?: boolean;
}): boolean {
  return resolveScalePlatformAccess(sub);
}

export function resolveCommunityMessengerWrsPlanAccessFromSubscriptionData(
  data: Record<string, unknown>,
  now: Date,
): boolean {
  const view = computeDatesView(data, now);
  return resolveCommunityMessengerWrsPlanAccess({
    planCode: String(data.planCode || ""),
    status: view.status,
    billingCycle: String(data.billingCycle || ""),
    isExpired: view.isExpired,
  });
}

export async function isBusinessEligibleForCommunityMessenger(
  businessId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await fetchRecentSubscriptionRows(businessId);
  const effective = pickEffectiveEntitling(rows, now);
  if (!effective) return false;
  return resolveCommunityMessengerWrsPlanAccessFromSubscriptionData(effective.data, now);
}

export async function assertCommunityMessengerWrsPlanAccess(
  businessId: string,
  res: Response,
): Promise<boolean> {
  const eligible = await isBusinessEligibleForCommunityMessenger(businessId);
  if (eligible) return true;
  res.status(403).json({
    error: "COMMUNITY_MESSENGER_PLAN_REQUIRED",
    message:
      "Community Messenger orders require a Scale or Enterprise plan (including Scale trial).",
  });
  return false;
}
