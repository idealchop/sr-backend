import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { getMarketingPlatformStats } from "../services/marketing/marketing-platform-stats-service";

/**
 * GET /public/marketing/platform-stats
 * Unauthenticated landing KPIs (cached platform rollup).
 */
export async function getPlatformStats(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await getMarketingPlatformStats();
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error("GET /public/marketing/platform-stats failed", error);
    res.status(500).json({ error: "Failed to load platform stats" });
  }
}
