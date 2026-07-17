import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { isSalesPortalOpsUser } from "../services/meta/community-dispatch-ops-notify-service";
import { notifyOwnersTutorialPublished } from "../services/events-training/notify-tutorial-published-service";
import { notifyOwnersWebinarPublished } from "../services/events-training/notify-webinar-published-service";
import { notifyOwnersResourcesVideoPublished } from "../services/events-training/notify-resources-video-published-service";
import { answerVideoPost, listOpsEngagementQuestions } from "../services/events-training/member-engagement-service";
import { opsSetWebinarAttendance } from "../services/events-training/member-registration-service";
import { getWebinarOpsInsights } from "../services/events-training/member-webinar-insights-service";

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

/** Sales Portal → notify station owners that a WRS Story / webinar recording was published. */
export async function postNotifyResourcesVideoPublished(
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
      category?: string;
    };
    const videoId = String(body.videoId || "").trim();
    const name = String(body.name || "").trim();
    const category =
      body.category === "webinar" ? "webinar" : "wrs_stories";
    if (!videoId || !name) {
      res.status(400).json({ error: "videoId and name are required." });
      return;
    }

    const result = await notifyOwnersResourcesVideoPublished({
      videoId,
      name,
      category,
    });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_ID_REQUIRED") {
      res.status(400).json({ error: "videoId is required." });
      return;
    }
    logger.error("postNotifyResourcesVideoPublished failed", error);
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

/**
 * Sales Portal → answer a member question/comment on a webinar or story recording.
 * Body is moderated (local + Gemini) before write.
 */
export async function postAnswerVideoEngagementPost(
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
    const postId = String(req.params.postId || "").trim();
    const answer = String((req.body as { answer?: string })?.answer || "");
    if (!videoId || !postId) {
      res.status(400).json({ error: "videoId and postId are required." });
      return;
    }

    const data = await answerVideoPost({
      videoId,
      postId,
      answer,
      answeredByUid: uid,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ?
        Number((error as { status?: number }).status) || 500 :
        500;
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postAnswerVideoEngagementPost failed", error);
    res.status(500).json({ error: "Failed to save answer." });
  }
}

/** GET /events-training/ops/questions?unansweredOnly=&page=&pageSize= */
export async function getOpsEngagementQuestions(
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

    const unansweredRaw = String(req.query.unansweredOnly ?? "true");
    const data = await listOpsEngagementQuestions({
      unansweredOnly: unansweredRaw !== "false",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getOpsEngagementQuestions failed", error);
    res.status(500).json({ error: "Failed to load questions." });
  }
}

/** GET /events-training/ops/insights */
export async function getOpsWebinarInsights(
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
    const data = await getWebinarOpsInsights();
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getOpsWebinarInsights failed", error);
    res.status(500).json({ error: "Failed to load insights." });
  }
}

/**
 * POST /events-training/ops/registrations/:registrationId/attendance
 * { attendanceStatus: attended | no_show | cleared }
 */
export async function postOpsWebinarAttendance(
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

    const registrationId = String(req.params.registrationId || "").trim();
    const statusRaw = String(
      (req.body as { attendanceStatus?: string })?.attendanceStatus || "",
    ).trim();
    if (
      statusRaw !== "attended" &&
      statusRaw !== "no_show" &&
      statusRaw !== "cleared"
    ) {
      res.status(400).json({
        error: "attendanceStatus must be attended, no_show, or cleared.",
      });
      return;
    }

    const data = await opsSetWebinarAttendance({
      registrationId,
      attendanceStatus: statusRaw,
      opsUid: uid,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ?
        Number((error as { status?: number }).status) || 500 :
        500;
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postOpsWebinarAttendance failed", error);
    res.status(500).json({ error: "Failed to update attendance." });
  }
}
