import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";
import {
  acceptCommunityDispatchOffer,
  declineCommunityDispatchOffer,
  getPendingCommunityDispatchOfferForBusiness,
  isOfferExpired,
} from "../services/meta/community-dispatch-offer-service";
import {
  getCommunityDispatchSettings,
  patchCommunityDispatchSettings,
} from "../services/meta/community-dispatch-settings-service";
import {
  isSalesPortalOpsUser,
  notifyCommunityDispatchOfferFromOps,
} from "../services/meta/community-dispatch-ops-notify-service";
import { checkBusinessAccess } from "../utils/auth-utils";

/** Internal directory preview for ops/tests (authenticated). */
export async function getCommunityDispatchDirectoryPreview(
  req: Request,
  res: Response,
): Promise<void> {
  const user = (req as { user?: { uid?: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { loadCommunityWrsDirectory } = await import(
      "../services/meta/community-dispatch-wrs-directory-service"
    );
    const rows = await loadCommunityWrsDirectory();
    res.json({ data: rows });
  } catch (error) {
    logger.error("getCommunityDispatchDirectoryPreview failed", error);
    res.status(500).json({ error: "Failed to load directory" });
  }
}

function readOfferExpiresAtIso(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === "function") {
    return maybe.toDate().toISOString();
  }
  return null;
}

/** Pending community offer for a station dashboard card. */
export async function getPendingCommunityDispatchOffer(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;

  if (!user?.uid || !businessId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { hasAccess, businessDoc } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || !businessDoc) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const offer = await getPendingCommunityDispatchOfferForBusiness(businessId);
    if (!offer) {
      res.json({ data: null });
      return;
    }

    const requestSnap = await db
      .collection("community_dispatch_requests")
      .doc(offer.requestId)
      .get();
    const request = requestSnap.exists ?
      (requestSnap.data() as Record<string, unknown>) :
      null;

    res.json({
      data: {
        offerId: offer.id,
        requestId: offer.requestId,
        status: offer.status,
        expiresAt: readOfferExpiresAtIso(offer.expiresAt),
        expired: isOfferExpired(offer),
        rank: offer.rank,
        request: request ?
          {
            referenceId: request.referenceId,
            parsed: request.parsed,
            geocode: request.geocode,
            routingNotes: request.routingNotes,
          } :
          null,
      },
    });
  } catch (error) {
    logger.error("getPendingCommunityDispatchOffer failed", error);
    res.status(500).json({ error: "Failed to load pending offer" });
  }
}

/** Station accepts a community dispatch offer — first accept wins. */
export async function postAcceptCommunityDispatchOffer(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId, offerId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;

  if (!user?.uid || !businessId || !offerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { hasAccess, businessDoc } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || !businessDoc) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const result = await acceptCommunityDispatchOffer({
      offerId,
      businessId,
      acceptedByUid: user.uid,
    });

    if (!result.ok) {
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "FORBIDDEN" || result.code === "PLAN_NOT_ELIGIBLE" ? 403 :
            result.code === "EXPIRED" ? 410 :
              result.code === "ALREADY_ACCEPTED" ? 409 :
                409;
      res.status(status).json({ error: result.code });
      return;
    }

    res.json({
      data: {
        submissionId: result.submissionId,
        submissionReferenceId: result.submissionReferenceId,
        customerMessengerNotified: result.customerMessengerNotified,
        customerMessengerNotifyError: result.customerMessengerNotifyError,
      },
    });
  } catch (error) {
    logger.error("postAcceptCommunityDispatchOffer failed", error);
    res.status(500).json({ error: "Failed to accept offer" });
  }
}

/** Station declines a community dispatch offer. */
export async function postDeclineCommunityDispatchOffer(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId, offerId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;
  const body = (req.body ?? {}) as { reason?: string };

  if (!user?.uid || !businessId || !offerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { hasAccess, businessDoc } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || !businessDoc) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const result = await declineCommunityDispatchOffer({
      offerId,
      businessId,
      declineReason: body.reason,
    });
    if (!result.ok) {
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "FORBIDDEN" ? 403 :
            409;
      res.status(status).json({ error: result.code });
      return;
    }

    res.json({ data: { ok: true } });
  } catch (error) {
    logger.error("postDeclineCommunityDispatchOffer failed", error);
    res.status(500).json({ error: "Failed to decline offer" });
  }
}

/** CP-10 — owner reads community dispatch opt-in settings. */
export async function getCommunityDispatchSettingsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;

  if (!user?.uid || !businessId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const settings = await getCommunityDispatchSettings(businessId);
    if (!settings) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    res.json({ data: settings });
  } catch (error) {
    logger.error("getCommunityDispatchSettingsHandler failed", error);
    res.status(500).json({ error: "Failed to load community dispatch settings" });
  }
}

/** CP-10 / CP-18 — owner updates community dispatch opt-in settings. */
export async function patchCommunityDispatchSettingsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;
  const body = (req.body ?? {}) as {
    publicName?: string;
    slug?: string | null;
  };

  if (!user?.uid || !businessId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const result = await patchCommunityDispatchSettings(businessId, body);
    if (!result.ok) {
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "PLAN_NOT_ELIGIBLE" || result.code === "MISSING_MAP_PIN" ? 403 :
            result.code === "SLUG_TAKEN" ? 409 :
              400;
      res.status(status).json({ error: result.code });
      return;
    }

    res.json({ data: result.settings });
  } catch (error) {
    logger.error("patchCommunityDispatchSettingsHandler failed", error);
    res.status(500).json({ error: "Failed to update community dispatch settings" });
  }
}

/** Sales Portal manual assign — send FCM offer push to station owners (CP-23). */
export async function postNotifyCommunityDispatchOffer(
  req: Request,
  res: Response,
): Promise<void> {
  const user = (req as { user?: { uid?: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    if (!(await isSalesPortalOpsUser(user.uid))) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    const body = (req.body ?? {}) as {
      offerId?: string;
      requestId?: string;
      businessId?: string;
    };
    const offerId = body.offerId?.trim();
    const requestId = body.requestId?.trim();
    const businessId = body.businessId?.trim();
    if (!offerId || !requestId || !businessId) {
      res.status(400).json({ error: "offerId, requestId, and businessId are required." });
      return;
    }

    const result = await notifyCommunityDispatchOfferFromOps({
      offerId,
      requestId,
      businessId,
    });
    res.json({ data: { sent: result.sent } });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    logger.error("postNotifyCommunityDispatchOffer failed", error);
    res.status(500).json({ error: "Failed to notify station." });
  }
}
