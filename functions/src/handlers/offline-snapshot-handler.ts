import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { buildOfflineSnapshot } from "../services/offline/offline-snapshot-service";

/**
 * GET /business/:businessId/offline-snapshot
 * Lean DTO for offline read cache warm-up (OFF-03 / OFF-10).
 */
export const getOfflineSnapshot = async (req: Request, res: Response) => {
  const { businessId } = req.params;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    const snapshot = await buildOfflineSnapshot(businessId);
    res.json({ data: snapshot });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message === "Business not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error(`offline-snapshot failed for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
