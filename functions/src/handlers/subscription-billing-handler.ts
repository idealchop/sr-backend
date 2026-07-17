import { Request, Response } from "express";
import { checkBusinessAccess } from "../utils/auth-utils";
import { SubscriptionBillingService } from "../services/subscriptions/subscription-billing-service";

function resolvePublicApiBase(req: Request): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api";
}

export const getSubscriptionBilling = async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId || "").trim();
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const data = await SubscriptionBillingService.getProfile(businessId);
    return res.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "BILLING_PROFILE_FAILED";
    return res.status(500).json({ error: msg });
  }
};

export const postSubscriptionBillingLink = async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId || "").trim();
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const result = await SubscriptionBillingService.createLinkSession(
      businessId,
      user.uid,
      resolvePublicApiBase(req),
      { update: req.body?.update === true },
    );

    if (result.alreadyLinked) {
      return res.status(200).json({
        data: { alreadyLinked: true, message: "Billing account is already linked." },
      });
    }

    return res.status(201).json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "BILLING_LINK_FAILED";
    const status =
      msg === "NO_ACTIVE_SUBSCRIPTION" || msg === "PLAN_NOT_ELIGIBLE" ? 409 :
        msg === "OWNER_EMAIL_REQUIRED" ? 400 :
          msg === "BILLING_LINK_UNAVAILABLE" ? 503 :
            400;
    return res.status(status).json({ error: msg });
  }
};
