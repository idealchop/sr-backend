import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { RiderMessengerLinkService } from "../services/rider/rider-messenger-link-service";

export async function postRiderMessengerLinkCode(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const { riderId } = req.body as { riderId?: string };

  if (!riderId?.trim()) {
    res.status(400).json({ error: "riderId is required" });
    return;
  }

  try {
    const data = await RiderMessengerLinkService.createLinkCode({
      businessId,
      riderId: riderId.trim(),
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
  try {
    await RiderMessengerLinkService.unlinkRider({ businessId, riderId });
    res.json({ success: true });
  } catch (error) {
    logger.error("deleteRiderMessengerLink failed", error);
    res.status(500).json({ error: "Failed to unlink rider" });
  }
}
