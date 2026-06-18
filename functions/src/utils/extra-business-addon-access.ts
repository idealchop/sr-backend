import type { Response } from "express";
import { SubscriptionService } from "../services/subscriptions/subscription-service";

export function readExtraBusinessAddonSlots(sub: {
  limitations?: { addonBoosts?: { extraBusiness?: number } };
} | null | undefined): number {
  const n = sub?.limitations?.addonBoosts?.extraBusiness;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function assertExtraBusinessAddonAccess(
  businessId: string,
  res: Response,
): Promise<boolean> {
  const sub = await SubscriptionService.getSubscriptionStatus(businessId);
  if (readExtraBusinessAddonSlots(sub) > 0) return true;
  res.status(403).json({
    error: "EXTRA_BUSINESS_ADDON_REQUIRED",
    message: "Owner hub requires the Additional business add-on.",
  });
  return false;
}
