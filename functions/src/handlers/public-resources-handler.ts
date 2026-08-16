import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import {
  getPublicResourceVideo,
  listPublicResourceVideos,
} from "../services/events-training/public-resources-service";
import { getPublicBlogEngagementSummary, attachBlogListEngagement } from "../services/events-training/blog-engagement-service";
import {
  getWrsBlogByIdOrSlug,
  listPublicWrsBlogs,
} from "../services/events-training/public-blogs-service";
import { listPublicWebinarEvents, getPublicWebinarEventById } from "../services/events-training/public-webinar-events-service";
import { registerGuestForWebinar } from "../services/events-training/guest-webinar-registration-service";
import {
  getGuestWebinarJoinByToken,
  joinGuestWebinarByEmail,
  joinGuestWebinarByToken,
  cancelGuestWebinarByToken,
} from "../services/events-training/guest-webinar-join-service";
import { createGuestWebinarUnlockCheckout, getGuestReplayAccess } from "../services/events-training/guest-webinar-unlock-service";
import { claimGuestWebinarCertificate } from "../services/events-training/guest-webinar-certificate-service";
import {
  attachWebinarEventListEngagement,
  createPublicWebinarEventComment,
  listPublicWebinarEventComments,
  resolveGuestLikeId,
  setPublicWebinarEventLike,
} from "../services/events-training/webinar-event-engagement-service";

function resolvePublicApiBase(req: Request): string {
  const configured = process.env.SMARTREFILL_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  if (host) return `${proto}://${host}`;
  return "";
}

/** GET /public/resources/wrs-stories */
export async function getPublicWrsStories(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await listPublicResourceVideos({
      category: "wrs_stories",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      featuredOnly: String(req.query.featured || "") === "true",
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getPublicWrsStories failed", error);
    res.status(500).json({ error: "Failed to load WRS Stories." });
  }
}

/** GET /public/resources/tutorials — published tutorials with showOnResources. */
export async function getPublicTutorials(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await listPublicResourceVideos({
      category: "tutorial",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      featuredOnly: String(req.query.featured || "") === "true",
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getPublicTutorials failed", error);
    res.status(500).json({ error: "Failed to load tutorials." });
  }
}

/** GET /public/resources/webinars — published webinar *recordings* (legacy/share). */
export async function getPublicWebinarRecordings(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await listPublicResourceVideos({
      category: "webinar",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      featuredOnly: String(req.query.featured || "") === "true",
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getPublicWebinarRecordings failed", error);
    res.status(500).json({ error: "Failed to load webinars." });
  }
}

/**
 * GET /public/resources/webinar-events
 * Latest (default) or Archives (`archives=true`) by schedule.
 */
export async function getPublicWebinarEvents(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const page = await listPublicWebinarEvents({
      archives: String(req.query.archives || "") === "true",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    const items = await attachWebinarEventListEngagement(page.items);
    res.json({ success: true, data: { ...page, items } });
  } catch (error) {
    logger.error("getPublicWebinarEvents failed", error);
    res.status(500).json({ error: "Failed to load webinar events." });
  }
}

/**
 * GET /public/resources/webinar-events/:eventId
 * Single public webinar for detail pages / SEO (works when list paging misses the id).
 */
export async function getPublicWebinarEvent(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const event = await getPublicWebinarEventById(String(req.params.eventId || ""));
    if (!event) {
      res.status(404).json({ error: "Webinar not found." });
      return;
    }
    const [withEngagement] = await attachWebinarEventListEngagement([event]);
    res.json({ success: true, data: withEngagement });
  } catch (error) {
    logger.error("getPublicWebinarEvent failed", error);
    res.status(500).json({ error: "Failed to load webinar event." });
  }
}

/** GET /public/resources/webinar-events/:eventId/comments */
export async function getPublicWebinarEventComments(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await listPublicWebinarEventComments({
      eventId: String(req.params.eventId || ""),
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    if (status === 404) {
      res.status(404).json({ error: "Webinar not found." });
      return;
    }
    logger.error("getPublicWebinarEventComments failed", error);
    res.status(500).json({ error: "Failed to load comments." });
  }
}

/** POST /public/resources/webinar-events/:eventId/comments */
export async function postPublicWebinarEventComment(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = (req.body || {}) as { text?: string; displayName?: string };
    const data = await createPublicWebinarEventComment({
      eventId: String(req.params.eventId || ""),
      text: String(body.text || ""),
      displayName: body.displayName,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    const message =
      error instanceof Error ? error.message : "Failed to post comment.";
    if (status === 400 || status === 404) {
      res.status(status).json({ error: message });
      return;
    }
    logger.error("postPublicWebinarEventComment failed", error);
    res.status(500).json({ error: "Failed to post comment." });
  }
}

/** POST /public/resources/webinar-events/:eventId/like */
export async function postPublicWebinarEventLike(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = (req.body || {}) as { guestId?: string };
    const guestId = resolveGuestLikeId(
      body.guestId || req.get("x-guest-id"),
      `${req.ip || ""}:${req.get("user-agent") || ""}`,
    );
    const data = await setPublicWebinarEventLike({
      eventId: String(req.params.eventId || ""),
      guestId,
      liked: true,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    if (status === 404) {
      res.status(404).json({ error: "Webinar not found." });
      return;
    }
    logger.error("postPublicWebinarEventLike failed", error);
    res.status(500).json({ error: "Failed to like webinar." });
  }
}

/** DELETE /public/resources/webinar-events/:eventId/like */
export async function deletePublicWebinarEventLike(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = (req.body || {}) as { guestId?: string };
    const guestId = resolveGuestLikeId(
      body.guestId || req.query.guestId || req.get("x-guest-id"),
      `${req.ip || ""}:${req.get("user-agent") || ""}`,
    );
    const data = await setPublicWebinarEventLike({
      eventId: String(req.params.eventId || ""),
      guestId,
      liked: false,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    if (status === 404) {
      res.status(404).json({ error: "Webinar not found." });
      return;
    }
    logger.error("deletePublicWebinarEventLike failed", error);
    res.status(500).json({ error: "Failed to unlike webinar." });
  }
}

/** GET /public/resources/videos/:videoId */
export async function getPublicResourceVideoById(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const video = await getPublicResourceVideo(String(req.params.videoId || ""));
    if (!video) {
      res.status(404).json({ error: "Video not found." });
      return;
    }
    res.json({ success: true, data: video });
  } catch (error) {
    logger.error("getPublicResourceVideoById failed", error);
    res.status(500).json({ error: "Failed to load video." });
  }
}

/** GET /public/resources/blogs — Sales Portal WRS Blog catalog. */
export async function getPublicWrsBlogs(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const page = await listPublicWrsBlogs({
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      featuredOnly: String(req.query.featured || "") === "true",
    });
    const items = await attachBlogListEngagement(page.items);
    res.json({ success: true, data: { ...page, items } });
  } catch (error) {
    logger.error("getPublicWrsBlogs failed", error);
    res.status(500).json({ error: "Failed to load blogs." });
  }
}

/** GET /public/resources/blogs/:idOrSlug */
export async function getPublicWrsBlogById(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const blog = await getWrsBlogByIdOrSlug(String(req.params.idOrSlug || ""));
    if (!blog) {
      res.status(404).json({ error: "Article not found." });
      return;
    }
    const [enriched] = await attachBlogListEngagement([blog]);
    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error("getPublicWrsBlogById failed", error);
    res.status(500).json({ error: "Failed to load article." });
  }
}

/** GET /public/resources/blogs/:articleId/engagement */
export async function getPublicBlogEngagement(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }
    const data = await getPublicBlogEngagementSummary(articleId);
    res.json({ success: true, data });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status: number }).status === 404
    ) {
      res.status(404).json({
        error: error instanceof Error ? error.message : "Article not found.",
      });
      return;
    }
    logger.error("getPublicBlogEngagement failed", error);
    res.status(500).json({ error: "Failed to load article engagement." });
  }
}

/**
 * POST /public/resources/webinar-events/:eventId/register
 * Guest register (visibility:public only). No Firebase auth.
 */
export async function postGuestWebinarRegister(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const body = req.body ?? {};
    const data = await registerGuestForWebinar({
      eventId,
      email: body.email,
      displayName: body.displayName ?? body.name,
      emailReminderOptIn:
        body.emailReminderOptIn === undefined ?
          undefined :
          Boolean(body.emailReminderOptIn),
    });
    res.status(data.alreadyRegistered ? 200 : 201).json({
      success: true,
      data: {
        registrationId: data.registrationId,
        eventId: data.eventId,
        status: data.status,
        requiresApproval: data.requiresApproval,
        alreadyRegistered: data.alreadyRegistered,
      },
    });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarRegister");
  }
}

/** GET /public/resources/webinar-join/:token */
export async function getGuestWebinarJoin(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await getGuestWebinarJoinByToken(String(req.params.token || ""));
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "getGuestWebinarJoin");
  }
}

/** POST /public/resources/webinar-join/:token — open live session + attendance */
export async function postGuestWebinarJoinByToken(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await joinGuestWebinarByToken(String(req.params.token || ""));
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarJoinByToken");
  }
}

/** POST /public/resources/webinar-join/:token/cancel */
export async function postGuestWebinarCancel(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await cancelGuestWebinarByToken(String(req.params.token || ""));
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarCancel");
  }
}

/**
 * POST /public/resources/webinar-events/:eventId/join
 * Catalog Join with registered guest email (no token required).
 */
export async function postGuestWebinarJoinByEmail(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const body = req.body ?? {};
    const data = await joinGuestWebinarByEmail({
      eventId,
      email: body.email,
    });
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarJoinByEmail");
  }
}

/**
 * POST /public/resources/webinar-events/:eventId/unlock-checkout
 * Guest PayMongo for premium webinars (email only).
 */
export async function postGuestWebinarUnlockCheckout(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const body = req.body ?? {};
    const data = await createGuestWebinarUnlockCheckout({
      eventId,
      email: body.email,
      displayName: body.displayName ?? body.name,
      apiBaseUrl: resolvePublicApiBase(req),
    });
    res.status(data.alreadyUnlocked ? 200 : 201).json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarUnlockCheckout");
  }
}

/**
 * POST /public/resources/webinar-events/:eventId/replay
 * Paid guest replay access by email.
 */
export async function postGuestWebinarReplay(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const body = req.body ?? {};
    const data = await getGuestReplayAccess({
      eventId,
      email: body.email,
      token: body.token,
    });
    if (!data.allowed) {
      res.status(403).json({
        error: "Replay is available after premium guest payment.",
        code: data.reason || "NOT_ALLOWED",
      });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarReplay");
  }
}

/**
 * POST /public/resources/webinar-events/:eventId/certificate
 * Paid guest certificate claim (attendance required).
 */
export async function postGuestWebinarCertificate(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const body = req.body ?? {};
    const data = await claimGuestWebinarCertificate({
      eventId,
      email: body.email,
    });
    res.json({ success: true, data });
  } catch (error) {
    respondGuestError(res, error, "postGuestWebinarCertificate");
  }
}

function respondGuestError(
  res: Response,
  error: unknown,
  logLabel: string,
): void {
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" ?
      (error as { status: number }).status :
      500;
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" ?
      (error as { code: string }).code :
      undefined;
  if (status >= 500) {
    logger.error(`${logLabel} failed`, error);
  }
  res.status(status).json({
    error:
      error instanceof Error ? error.message : "Guest webinar request failed.",
    ...(code ? { code } : {}),
  });
}
