import { Request, Response } from "express";
import {
  FeatureRatingsService,
  normalizeFeatureRatingsAppId,
} from "../services/platform/feature-ratings-service";

function getUser(req: Request) {
  return (
    req as Request & { user?: { uid: string; email?: string; name?: string } }
  ).user;
}

export async function postFeatureRatings(req: Request, res: Response) {
  const user = getUser(req);
  const { businessId } = req.params;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body ?? {};
  const featureId =
    typeof body.featureId === "string" ? body.featureId.trim() : "";
  if (!featureId) {
    res.status(400).json({ error: "featureId is required" });
    return;
  }

  const ratings = FeatureRatingsService.validateRatingsPayload(body.ratings);
  if (!ratings) {
    res.status(400).json({
      error:
        "ratings.uiLayout and ratings.functionality are required (1–5 each)",
    });
    return;
  }

  try {
    const record = await FeatureRatingsService.submit({
      appId: normalizeFeatureRatingsAppId(
        typeof body.appId === "string" ? body.appId : undefined,
      ),
      source: typeof body.source === "string" ? body.source : "dashboard",
      businessId,
      userId: user.uid,
      userEmail: user.email,
      displayName: user.name,
      role: (req as Request & { businessRole?: string }).businessRole,
      featureId,
      ratings,
      feedback: typeof body.feedback === "string" ? body.feedback : "",
    });

    res.status(201).json({ data: record });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_RATINGS") {
      res.status(400).json({ error: "Invalid ratings payload" });
      return;
    }
    if (err instanceof Error && err.message === "FEATURE_RATING_WRITE_FAILED") {
      res.status(500).json({ error: "Feature rating saved but could not be read back" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[postFeatureRatings]", err);
    res.status(500).json({
      error: "Failed to submit feature ratings",
      ...(process.env.FUNCTIONS_EMULATOR ? { details: message } : {}),
    });
  }
}

export async function getMyFeatureRatings(req: Request, res: Response) {
  const user = getUser(req);
  const { businessId } = req.params;
  const featureId =
    typeof req.query.featureId === "string" ? req.query.featureId.trim() : "";
  const appId = normalizeFeatureRatingsAppId(
    typeof req.query.appId === "string" ? req.query.appId : undefined,
  );

  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!featureId) {
    res.status(400).json({ error: "featureId query param is required" });
    return;
  }

  try {
    const record = await FeatureRatingsService.getLatestForUser(
      businessId,
      user.uid,
      featureId,
      appId,
    );
    res.status(200).json({ data: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[getMyFeatureRatings]", err);
    res.status(500).json({
      error: "Failed to load feature ratings",
      ...(process.env.FUNCTIONS_EMULATOR ? { details: message } : {}),
    });
  }
}
