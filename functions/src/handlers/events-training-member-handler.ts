import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { checkBusinessAccess } from "../utils/auth-utils";
import {
  listMemberTrainingVideos,
  listMemberWebinars,
} from "../services/events-training/member-catalog-service";
import {
  cancelWebinarRegistration,
  markWebinarJoinAttendance,
  registerForWebinar,
} from "../services/events-training/member-registration-service";
import {
  createVideoPost,
  getVideoEngagement,
  listVideoPosts,
  markVideoWatched,
  saveVideoNote,
  toggleVideoLike,
} from "../services/events-training/member-engagement-service";
import {
  createBlogComment,
  getBlogEngagement,
  listBlogPosts,
  toggleBlogLike,
  attachBlogListEngagement,
} from "../services/events-training/blog-engagement-service";
import {
  getWrsBlogByIdOrSlug,
  listMemberWrsBlogs,
} from "../services/events-training/public-blogs-service";

type AuthedRequest = Request & {
  user?: { uid?: string; email?: string };
};

function requireUser(req: AuthedRequest, res: Response): string | null {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return uid;
}

function readBusinessId(req: Request): string {
  const fromQuery = String(req.query.businessId || "").trim();
  if (fromQuery) return fromQuery;
  return String((req.body as { businessId?: string })?.businessId || "").trim();
}

async function requireBusinessMember(
  req: AuthedRequest,
  res: Response,
  businessId: string,
): Promise<string | null> {
  const uid = requireUser(req, res);
  if (!uid) return null;
  if (!businessId) {
    res.status(400).json({ error: "businessId is required." });
    return null;
  }
  const access = await checkBusinessAccess(uid, businessId);
  if (!access.hasAccess) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return uid;
}

function engagementErrorStatus(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return 500;
}

/** GET /events-training/webinars?businessId=&archives=&q=&page=&pageSize= */
export async function getMemberWebinars(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const data = await listMemberWebinars({
      userId: uid,
      businessId,
      archives: String(req.query.archives || "") === "true",
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getMemberWebinars failed", error);
    res.status(500).json({ error: "Failed to load webinars." });
  }
}

/** GET /events-training/videos?businessId=&category=&q=&page=&pageSize= */
export async function getMemberVideos(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const categoryRaw = String(req.query.category || "all").trim();
    const category =
      categoryRaw === "webinar" || categoryRaw === "wrs_stories" ?
        categoryRaw :
        "all";

    const data = await listMemberTrainingVideos({
      businessId,
      userId: uid,
      category,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getMemberVideos failed", error);
    res.status(500).json({ error: "Failed to load training videos." });
  }
}

/** POST /events-training/webinars/:eventId/register { businessId, email? } */
export async function postRegisterWebinar(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    const result = await registerForWebinar({
      eventId,
      userId: uid,
      businessId,
      email:
        typeof (req.body as { email?: string })?.email === "string" ?
          (req.body as { email?: string }).email :
          req.user?.email,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EVENT_ID_REQUIRED" || message === "BUSINESS_ID_REQUIRED") {
      res.status(400).json({ error: message });
      return;
    }
    if (message === "EVENT_NOT_FOUND") {
      res.status(404).json({ error: "Webinar not found." });
      return;
    }
    if (message === "EVENT_NOT_OPEN") {
      res.status(409).json({ error: "This webinar is not open for registration." });
      return;
    }
    if (
      message === "This webinar is limited to selected subscription plans." ||
      (error as { code?: string })?.code === "PLAN_REQUIRED"
    ) {
      res.status(403).json({
        error: "This webinar is limited to selected subscription plans.",
      });
      return;
    }
    if (
      (error as { code?: string })?.code === "PREMIUM_PAYMENT_REQUIRED" ||
      message.includes("premium webinar")
    ) {
      res.status(402).json({
        error:
          "This is a premium webinar. Complete PayMongo payment to register.",
        code: "PREMIUM_PAYMENT_REQUIRED",
      });
      return;
    }
    if (
      (error as { code?: string })?.code === "CAPACITY_FULL" ||
      message.includes("webinar is full")
    ) {
      res.status(409).json({
        error: "This webinar is full. Registration is closed.",
        code: "CAPACITY_FULL",
      });
      return;
    }
    logger.error("postRegisterWebinar failed", error);
    res.status(500).json({ error: "Failed to register for webinar." });
  }
}

/** POST /events-training/webinars/:eventId/cancel { businessId } */
export async function postCancelWebinar(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    const result = await cancelWebinarRegistration({
      eventId,
      userId: uid,
      businessId,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EVENT_ID_REQUIRED") {
      res.status(400).json({ error: message });
      return;
    }
    if (message === "REGISTRATION_NOT_FOUND") {
      res.status(404).json({ error: "Registration not found." });
      return;
    }
    if (message === "REGISTRATION_NOT_CANCELLABLE") {
      res.status(409).json({ error: "This registration cannot be cancelled." });
      return;
    }
    logger.error("postCancelWebinar failed", error);
    res.status(500).json({ error: "Failed to cancel registration." });
  }
}

/** POST /events-training/webinars/:eventId/join { businessId }
 *  — record attendance when opening join link */
export async function postJoinWebinar(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    const result = await markWebinarJoinAttendance({
      eventId,
      userId: uid,
      businessId,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = (error as { code?: string })?.code;
    if (message === "EVENT_ID_REQUIRED" || message === "BUSINESS_ID_REQUIRED") {
      res.status(400).json({ error: message });
      return;
    }
    if (message === "REGISTRATION_NOT_FOUND") {
      res.status(404).json({ error: "Registration not found." });
      return;
    }
    if (code === "NOT_ACCEPTED") {
      res.status(403).json({ error: message, code });
      return;
    }
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({ error: message || "Request failed." });
      return;
    }
    logger.error("postJoinWebinar failed", error);
    res.status(500).json({ error: "Failed to record attendance." });
  }
}

/** POST /events-training/webinars/:eventId/certificate { businessId } */
export async function postClaimWebinarCertificate(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    const { claimWebinarCertificate } = await import(
      "../services/events-training/member-webinar-certificate-service"
    );
    const data = await claimWebinarCertificate({
      eventId,
      businessId,
      userId: uid,
    });
    res.status(data.alreadyClaimed ? 200 : 201).json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
        code: (error as { code?: string })?.code,
      });
      return;
    }
    logger.error("postClaimWebinarCertificate failed", error);
    res.status(500).json({ error: "Failed to claim certificate." });
  }
}

/** GET /events-training/webinars/:eventId/certificate?businessId=&disposition= */
export async function getWebinarCertificatePdf(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    const dispositionRaw = String(req.query.disposition || "attachment").trim().toLowerCase();
    const disposition = dispositionRaw === "inline" ? "inline" : "attachment";

    const { getWebinarCertificatePdf: buildPdf } = await import(
      "../services/events-training/member-webinar-certificate-service"
    );
    const { buffer, filename } = await buildPdf({
      eventId,
      businessId,
      userId: uid,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${filename.replace(/"/g, "")}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buffer);
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
        code: (error as { code?: string })?.code,
      });
      return;
    }
    logger.error("getWebinarCertificatePdf failed", error);
    res.status(500).json({ error: "Failed to load certificate PDF." });
  }
}

/** GET /events-training/videos/:videoId/engagement?businessId= */
export async function getMemberVideoEngagement(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const data = await getVideoEngagement({ videoId, userId: uid });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberVideoEngagement failed", error);
    res.status(500).json({ error: "Failed to load engagement." });
  }
}

/** GET /events-training/videos/:videoId/posts?businessId=&kind=&page=&pageSize= */
export async function getMemberVideoPosts(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const kindRaw = String(req.query.kind || "").trim();
    const kind =
      kindRaw === "question" ? "question" : kindRaw === "comment" ? "comment" : null;
    if (!kind) {
      res.status(400).json({ error: "kind must be comment or question." });
      return;
    }

    const data = await listVideoPosts({
      videoId,
      userId: uid,
      kind,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberVideoPosts failed", error);
    res.status(500).json({ error: "Failed to load posts." });
  }
}

/** POST /events-training/videos/:videoId/like { businessId } */
export async function postMemberVideoLike(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const data = await toggleVideoLike({
      videoId,
      userId: uid,
      businessId,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postMemberVideoLike failed", error);
    res.status(500).json({ error: "Failed to update like." });
  }
}

/** POST /events-training/videos/:videoId/posts { businessId, kind, body } */
export async function postMemberVideoPost(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const body = req.body as { kind?: string; body?: string; anonymous?: boolean };
    const kind =
      body.kind === "question" ? "question" : body.kind === "comment" ? "comment" : null;
    if (!kind) {
      res.status(400).json({ error: "kind must be comment or question." });
      return;
    }
    if (typeof body.body !== "string") {
      res.status(400).json({ error: "body is required." });
      return;
    }

    const data = await createVideoPost({
      videoId,
      userId: uid,
      businessId,
      kind,
      body: body.body,
      anonymous: body.anonymous === true,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postMemberVideoPost failed", error);
    res.status(500).json({ error: "Failed to post." });
  }
}

/** PUT /events-training/videos/:videoId/notes { businessId, body } */
export async function putMemberVideoNote(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const body = req.body as { body?: string };
    if (typeof body.body !== "string") {
      res.status(400).json({
        error: "body is required (string; empty clears the note).",
      });
      return;
    }

    const data = await saveVideoNote({
      videoId,
      userId: uid,
      businessId,
      body: body.body,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("putMemberVideoNote failed", error);
    res.status(500).json({ error: "Failed to save note." });
  }
}

/** POST /events-training/videos/:videoId/watch { businessId } */
export async function postMemberVideoWatch(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const data = await markVideoWatched({
      videoId,
      userId: uid,
      businessId,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postMemberVideoWatch failed", error);
    res.status(500).json({ error: "Failed to mark watched." });
  }
}

function resolvePublicApiBase(req: Request): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api";
}

/** GET /events-training/videos/:videoId/unlock?businessId= */
export async function getMemberVideoUnlock(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const { preparePremiumVideoUnlock } = await import(
      "../services/events-training/member-video-unlock-service"
    );
    const prepared = await preparePremiumVideoUnlock({ videoId, businessId });
    res.json({
      success: true,
      data: {
        videoId: prepared.videoId,
        name: prepared.name,
        amount: prepared.amount,
        currency: "PHP",
        alreadyUnlocked: prepared.alreadyUnlocked,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberVideoUnlock failed", error);
    res.status(500).json({ error: "Failed to load unlock status." });
  }
}

/** POST /events-training/videos/:videoId/unlock-checkout { businessId } */
export async function postMemberVideoUnlockCheckout(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const videoId = String(req.params.videoId || "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId is required." });
      return;
    }

    const { preparePremiumVideoUnlock } = await import(
      "../services/events-training/member-video-unlock-service"
    );
    const prepared = await preparePremiumVideoUnlock({ videoId, businessId });

    if (prepared.alreadyUnlocked) {
      res.json({
        success: true,
        data: {
          alreadyUnlocked: true,
          videoId: prepared.videoId,
          amount: prepared.amount,
          currency: "PHP",
          checkoutUrl: null,
          intentId: null,
        },
      });
      return;
    }

    const { PaymentIntentService } = await import(
      "../services/payments/payment-intent-service"
    );
    const intent = await PaymentIntentService.createResourceVideoUnlockIntent({
      businessId,
      userId: uid,
      videoId: prepared.videoId,
      videoName: prepared.name,
      amount: prepared.amount,
      apiBaseUrl: resolvePublicApiBase(req),
    });

    res.status(201).json({
      success: true,
      data: {
        alreadyUnlocked: false,
        videoId: prepared.videoId,
        amount: intent.amount,
        currency: intent.currency,
        checkoutUrl: intent.checkoutUrl,
        intentId: intent.id,
        provider: intent.provider,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "UNLOCK_INPUT_REQUIRED" || msg === "NO_AMOUNT_DUE") {
      res.status(400).json({ error: "Unable to start checkout for this video." });
      return;
    }
    logger.error("postMemberVideoUnlockCheckout failed", error);
    res.status(500).json({ error: "Failed to start premium unlock checkout." });
  }
}

/** GET /events-training/webinars/:eventId/unlock?businessId= */
export async function getMemberWebinarUnlock(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) {
      res.status(400).json({ error: "eventId is required." });
      return;
    }

    const { preparePremiumWebinarUnlock } = await import(
      "../services/events-training/member-webinar-unlock-service"
    );
    const prepared = await preparePremiumWebinarUnlock({ eventId, businessId });
    res.json({
      success: true,
      data: {
        eventId: prepared.eventId,
        name: prepared.name,
        amount: prepared.amount,
        currency: "PHP",
        alreadyUnlocked: prepared.alreadyUnlocked,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberWebinarUnlock failed", error);
    res.status(500).json({ error: "Failed to load unlock status." });
  }
}

/** POST /events-training/webinars/:eventId/unlock-checkout { businessId } */
export async function postMemberWebinarUnlockCheckout(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) {
      res.status(400).json({ error: "eventId is required." });
      return;
    }

    const { preparePremiumWebinarUnlock } = await import(
      "../services/events-training/member-webinar-unlock-service"
    );
    const prepared = await preparePremiumWebinarUnlock({ eventId, businessId });

    if (prepared.alreadyUnlocked) {
      res.json({
        success: true,
        data: {
          alreadyUnlocked: true,
          eventId: prepared.eventId,
          amount: prepared.amount,
          currency: "PHP",
          checkoutUrl: null,
          intentId: null,
        },
      });
      return;
    }

    const { PaymentIntentService } = await import(
      "../services/payments/payment-intent-service"
    );
    const intent = await PaymentIntentService.createResourceWebinarUnlockIntent({
      businessId,
      userId: uid,
      eventId: prepared.eventId,
      eventName: prepared.name,
      amount: prepared.amount,
      apiBaseUrl: resolvePublicApiBase(req),
    });

    res.status(201).json({
      success: true,
      data: {
        alreadyUnlocked: false,
        eventId: prepared.eventId,
        amount: intent.amount,
        currency: intent.currency,
        checkoutUrl: intent.checkoutUrl,
        intentId: intent.id,
        provider: intent.provider,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "UNLOCK_INPUT_REQUIRED" || msg === "NO_AMOUNT_DUE") {
      res.status(400).json({ error: "Unable to start checkout for this webinar." });
      return;
    }
    logger.error("postMemberWebinarUnlockCheckout failed", error);
    res.status(500).json({ error: "Failed to start premium unlock checkout." });
  }
}

/** GET /events-training/blogs?businessId=&q=&page=&pageSize= — Sales Portal CMS. */
export async function getMemberBlogs(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const page = await listMemberWrsBlogs({
      businessId,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    const items = await attachBlogListEngagement(page.items);
    res.json({ success: true, data: { ...page, items } });
  } catch (error) {
    logger.error("getMemberBlogs failed", error);
    res.status(500).json({ error: "Failed to load blogs." });
  }
}

/** GET /events-training/blogs/:articleId?businessId= */
export async function getMemberBlogById(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const blog = await getWrsBlogByIdOrSlug(articleId, {
      memberAccess: true,
      businessId,
    });
    if (!blog) {
      res.status(404).json({ error: "Article not found." });
      return;
    }
    const [enriched] = await attachBlogListEngagement([blog]);
    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error("getMemberBlogById failed", error);
    res.status(500).json({ error: "Failed to load article." });
  }
}

/** GET /events-training/blogs/:articleId/unlock?businessId= */
export async function getMemberBlogUnlock(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const { preparePremiumBlogUnlock } = await import(
      "../services/events-training/member-blog-unlock-service"
    );
    const prepared = await preparePremiumBlogUnlock({ articleId, businessId });
    res.json({
      success: true,
      data: {
        articleId: prepared.articleId,
        title: prepared.title,
        amount: prepared.amount,
        currency: "PHP",
        alreadyUnlocked: prepared.alreadyUnlocked,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberBlogUnlock failed", error);
    res.status(500).json({ error: "Failed to load unlock status." });
  }
}

/** POST /events-training/blogs/:articleId/unlock-checkout { businessId } */
export async function postMemberBlogUnlockCheckout(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const { preparePremiumBlogUnlock } = await import(
      "../services/events-training/member-blog-unlock-service"
    );
    const prepared = await preparePremiumBlogUnlock({ articleId, businessId });

    if (prepared.alreadyUnlocked) {
      res.json({
        success: true,
        data: {
          alreadyUnlocked: true,
          articleId: prepared.articleId,
          amount: prepared.amount,
          currency: "PHP",
          checkoutUrl: null,
          intentId: null,
        },
      });
      return;
    }

    const { PaymentIntentService } = await import(
      "../services/payments/payment-intent-service"
    );
    const intent = await PaymentIntentService.createResourceBlogUnlockIntent({
      businessId,
      userId: uid,
      articleId: prepared.articleId,
      articleTitle: prepared.title,
      amount: prepared.amount,
      apiBaseUrl: resolvePublicApiBase(req),
    });

    res.status(201).json({
      success: true,
      data: {
        alreadyUnlocked: false,
        articleId: prepared.articleId,
        amount: intent.amount,
        currency: intent.currency,
        checkoutUrl: intent.checkoutUrl,
        intentId: intent.id,
        provider: intent.provider,
      },
    });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "UNLOCK_INPUT_REQUIRED" || msg === "NO_AMOUNT_DUE") {
      res.status(400).json({ error: "Unable to start checkout for this article." });
      return;
    }
    logger.error("postMemberBlogUnlockCheckout failed", error);
    res.status(500).json({ error: "Failed to start premium unlock checkout." });
  }
}

/** GET /events-training/blogs/:articleId/engagement?businessId= */
export async function getMemberBlogEngagement(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const data = await getBlogEngagement({ articleId, userId: uid });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberBlogEngagement failed", error);
    res.status(500).json({ error: "Failed to load article engagement." });
  }
}

/** GET /events-training/blogs/:articleId/posts?businessId=&page=&pageSize= */
export async function getMemberBlogPosts(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const data = await listBlogPosts({
      articleId,
      userId: uid,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("getMemberBlogPosts failed", error);
    res.status(500).json({ error: "Failed to load comments." });
  }
}

/** POST /events-training/blogs/:articleId/like { businessId } */
export async function postMemberBlogLike(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const data = await toggleBlogLike({
      articleId,
      userId: uid,
      businessId,
    });
    res.json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postMemberBlogLike failed", error);
    res.status(500).json({ error: "Failed to update like." });
  }
}

/** POST /events-training/blogs/:articleId/posts { businessId, body, anonymous? } */
export async function postMemberBlogPost(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  try {
    const businessId = readBusinessId(req);
    const uid = await requireBusinessMember(req, res, businessId);
    if (!uid) return;

    const articleId = String(req.params.articleId || "").trim();
    if (!articleId) {
      res.status(400).json({ error: "articleId is required." });
      return;
    }

    const body = req.body as { body?: string; anonymous?: boolean };
    if (typeof body.body !== "string") {
      res.status(400).json({ error: "body is required." });
      return;
    }

    const data = await createBlogComment({
      articleId,
      userId: uid,
      businessId,
      body: body.body,
      anonymous: body.anonymous === true,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    const status = engagementErrorStatus(error);
    if (status < 500) {
      res.status(status).json({
        error: error instanceof Error ? error.message : "Request failed.",
      });
      return;
    }
    logger.error("postMemberBlogPost failed", error);
    res.status(500).json({ error: "Failed to post comment." });
  }
}
