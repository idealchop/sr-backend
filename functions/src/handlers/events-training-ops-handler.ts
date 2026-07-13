import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { isSalesPortalOpsUser } from "../services/meta/community-dispatch-ops-notify-service";
import { notifyOwnersTutorialPublished } from "../services/events-training/notify-tutorial-published-service";
import { notifyOwnersWebinarPublished } from "../services/events-training/notify-webinar-published-service";

function requireOpsUser(req: Request, res: Response): string | null {
  const user = (req as {user?: {uid?: string}}).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user.uid;
}

/** Sales Portal → notify station owners that a tutorial video was published. */
export async function postNotifyTutorialPublished(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = requireOpsUser(req, res);
  if (!uid) return;

  try {
    if (!(await isSalesPortalOpsUser(uid))) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    const body = (req.body ?? {}) as {
      videoId?: string;
      name?: string;
      appId?: string | null;
      appPages?: string[] | null;
    };
    const videoId = String(body.videoId || "").trim();
    const name = String(body.name || "").trim();
    if (!videoId || !name) {
      res.status(400).json({ error: "videoId and name are required." });
      return;
    }

    const result = await notifyOwnersTutorialPublished({
      videoId,
      name,
      appId: body.appId,
      appPages: body.appPages,
    });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_ID_REQUIRED") {
      res.status(400).json({ error: "videoId is required." });
      return;
    }
    logger.error("postNotifyTutorialPublished failed", error);
    res.status(500).json({ error: "Failed to notify owners." });
  }
}

/** Sales Portal → notify station owners that a webinar was published. */
export async function postNotifyWebinarPublished(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = requireOpsUser(req, res);
  if (!uid) return;

  try {
    if (!(await isSalesPortalOpsUser(uid))) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    const body = (req.body ?? {}) as {
      eventId?: string;
      name?: string;
      startsAt?: string | null;
    };
    const eventId = String(body.eventId || "").trim();
    const name = String(body.name || "").trim();
    if (!eventId || !name) {
      res.status(400).json({ error: "eventId and name are required." });
      return;
    }

    const result = await notifyOwnersWebinarPublished({
      eventId,
      name,
      startsAt: body.startsAt,
    });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "EVENT_ID_REQUIRED") {
      res.status(400).json({ error: "eventId is required." });
      return;
    }
    logger.error("postNotifyWebinarPublished failed", error);
    res.status(500).json({ error: "Failed to notify owners." });
  }
}

/**
 * Ops read of last tutorial publish-notify status (dual-endpoint pairing).
 */
export async function getTutorialPublishNotice(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = requireOpsUser(req, res);
  if (!uid) return;

  try {
    if (!(await isSalesPortalOpsUser(uid))) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const { db } = await import("../config/firebase-admin");
    const snap = await db
      .collection("apps")
      .doc("smartrefill")
      .collection("training_video_publish_notices")
      .doc(videoId)
      .get();

    if (!snap.exists) {
      res.json({ data: null });
      return;
    }

    const data = snap.data() ?? {};
    res.json({
      data: {
        videoId,
        status: data.status ?? null,
        name: data.name ?? null,
        ownersNotified: data.ownersNotified ?? null,
        emailsSent: data.emailsSent ?? null,
        businessesScanned: data.businessesScanned ?? null,
      },
    });
  } catch (error) {
    logger.error("getTutorialPublishNotice failed", error);
    res.status(500).json({ error: "Failed to load notice status." });
  }
}
