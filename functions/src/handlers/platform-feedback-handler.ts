import { Request, Response } from "express";
import {
  normalizeAppsFeedbackAppId,
  PlatformFeedbackService,
} from "../services/platform/platform-feedback-service";

function getUser(req: Request) {
  return (
    req as Request & { user?: { uid: string; email?: string; name?: string } }
  ).user;
}

export async function postPlatformFeedback(req: Request, res: Response) {
  const user = getUser(req);
  const { businessId } = req.params;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body ?? {};
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be between 1 and 5" });
    return;
  }

  try {
    const record = await PlatformFeedbackService.submit({
      appId: normalizeAppsFeedbackAppId(
        typeof body.appId === "string" ? body.appId : undefined,
      ),
      source: typeof body.source === "string" ? body.source : "dashboard",
      businessId,
      userId: user.uid,
      userEmail: user.email,
      displayName: user.name,
      rating,
      feedback: typeof body.feedback === "string" ? body.feedback : "",
      recommend:
        body.recommend === true ?
          true :
          body.recommend === false ?
            false :
            null,
      nextUpdateSuggestion:
        typeof body.nextUpdateSuggestion === "string" ?
          body.nextUpdateSuggestion :
          "",
      plan: typeof body.plan === "string" ? body.plan : undefined,
      role: (req as Request & { businessRole?: string }).businessRole,
    });

    res.status(201).json({ data: record });
  } catch (err) {
    console.error("[postPlatformFeedback]", err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
}

export async function getMyPlatformFeedback(req: Request, res: Response) {
  const user = getUser(req);
  const { businessId } = req.params;
  const appId = normalizeAppsFeedbackAppId(
    typeof req.query.appId === "string" ? req.query.appId : undefined,
  );

  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const record = await PlatformFeedbackService.getLatestForUser(
      businessId,
      user.uid,
      appId,
    );
    res.status(200).json({ data: record });
  } catch (err) {
    console.error("[getMyPlatformFeedback]", err);
    res.status(500).json({ error: "Failed to load feedback" });
  }
}
