import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { loadPublicSubscriptionCatalog } from "../services/subscriptions/subscription-catalog-query";

/** GET /public/subscription-catalog — live published plans + trial policy. */
export async function getPublicSubscriptionCatalog(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await loadPublicSubscriptionCatalog();
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error("GET /public/subscription-catalog failed", error);
    res.status(500).json({ error: "Failed to load subscription catalog" });
  }
}
