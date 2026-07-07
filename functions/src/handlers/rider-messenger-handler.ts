import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import {
  canManageRiderMessengerLink,
  resolveSelfRiderIdForBusiness,
} from "../services/rider/rider-messenger-access";
import { RiderMessengerLinkService } from "../services/rider/rider-messenger-link-service";

export async function postRiderMessengerLinkCode(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const { riderId } = req.body as { riderId?: string };

  if (!riderId?.trim()) {
    res.status(400).json({ error: "riderId is required" });
    return;
  }

  const targetRiderId = riderId.trim();
  if (!(await canManageRiderMessengerLink(req, targetRiderId))) {
    res.status(403).json({ error: "You cannot manage Messenger link for this rider." });
    return;
  }

  try {
    const data = await RiderMessengerLinkService.createLinkCode({
      businessId,
      riderId: targetRiderId,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("postRiderMessengerLinkCode failed", error);
    const message = error instanceof Error ? error.message : "Failed to create link code";
    res.status(400).json({ error: message });
  }
}

export async function getRiderMessengerLinkStatus(req: Request, res: Response): Promise<void> {
  const { businessId, riderId } = req.params;

  if (!(await canManageRiderMessengerLink(req, riderId))) {
    res.status(403).json({ error: "You cannot view Messenger link for this rider." });
    return;
  }

  try {
    const data = await RiderMessengerLinkService.getLinkStatus({ businessId, riderId });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getRiderMessengerLinkStatus failed", error);
    res.status(500).json({ error: "Failed to read link status" });
  }
}

export async function deleteRiderMessengerLink(req: Request, res: Response): Promise<void> {
  const { businessId, riderId } = req.params;

  if (!(await canManageRiderMessengerLink(req, riderId))) {
    res.status(403).json({ error: "You cannot unlink Messenger for this rider." });
    return;
  }

  try {
    await RiderMessengerLinkService.unlinkRider({ businessId, riderId });
    res.json({ success: true });
  } catch (error) {
    logger.error("deleteRiderMessengerLink failed", error);
    res.status(500).json({ error: "Failed to unlink rider" });
  }
}

/** App rider — link code for the signed-in user's rider profile. */
export async function postRiderMessengerLinkCodeMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const role = (req as { businessRole?: string }).businessRole;
  if (role !== "rider") {
    res.status(403).json({
      error: "Use Team Hub to connect Messenger for other riders, or sign in as a rider here.",
    });
    return;
  }

  const riderId = await resolveSelfRiderIdForBusiness(businessId, uid);
  if (!riderId) {
    res.status(403).json({
      error: "No rider profile linked to your account. Ask your owner to link you in Team Hub.",
    });
    return;
  }

  try {
    const data = await RiderMessengerLinkService.createLinkCode({ businessId, riderId });
    res.json({ success: true, data: { ...data, riderId } });
  } catch (error) {
    logger.error("postRiderMessengerLinkCodeMe failed", error);
    const message = error instanceof Error ? error.message : "Failed to create link code";
    res.status(400).json({ error: message });
  }
}

export async function getRiderMessengerLinkStatusMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const riderId = await resolveSelfRiderIdForBusiness(businessId, uid);
  if (!riderId) {
    res.status(403).json({ error: "No rider profile linked to your account." });
    return;
  }

  try {
    const data = await RiderMessengerLinkService.getLinkStatus({ businessId, riderId });
    res.json({ success: true, data: { ...data, riderId } });
  } catch (error) {
    logger.error("getRiderMessengerLinkStatusMe failed", error);
    res.status(500).json({ error: "Failed to read link status" });
  }
}

export async function deleteRiderMessengerLinkMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const riderId = await resolveSelfRiderIdForBusiness(businessId, uid);
  if (!riderId) {
    res.status(403).json({ error: "No rider profile linked to your account." });
    return;
  }

  try {
    await RiderMessengerLinkService.unlinkRider({ businessId, riderId });
    res.json({ success: true });
  } catch (error) {
    logger.error("deleteRiderMessengerLinkMe failed", error);
    res.status(500).json({ error: "Failed to unlink rider" });
  }
}
