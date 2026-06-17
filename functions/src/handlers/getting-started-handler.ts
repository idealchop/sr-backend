import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { syncGettingStartedOnBusiness } from "../services/business/getting-started-sync-service";

/**
 * GET /business/:businessId/getting-started/sync
 * Reconciles `businesses.gettingStarted` with Firestore collection evidence.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 */
export const syncGettingStarted = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid?: string; email_verified?: boolean } }).user;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    const result = await syncGettingStartedOnBusiness(businessId, {
      emailVerified: user?.email_verified === true,
    });

    res.json({
      data: {
        gettingStarted: result.gettingStarted,
        updated: result.updated,
        patch: result.patch,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message === "Business not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error(`getting-started sync failed for ${businessId}`, error);
    res.status(500).json({ error: message });
  }
};
