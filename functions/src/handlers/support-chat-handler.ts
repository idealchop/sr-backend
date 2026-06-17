import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { SupportChatService } from "../services/support/support-chat-service";
import { SupportAiLimitError } from "../services/support/support-ai-usage-service";

function mapError(res: Response, e: unknown): void {
  if (e instanceof SupportAiLimitError) {
    res.status(429).json({ error: e.message, code: e.code });
    return;
  }
  const msg = e instanceof Error ? e.message : "Unknown error";
  switch (msg) {
  case "EMPTY_MESSAGE":
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  case "SESSION_NOT_FOUND":
    res.status(404).json({ error: "Support session not found." });
    return;
  case "FORBIDDEN":
    res.status(403).json({ error: "Forbidden." });
    return;
  case "SESSION_RESOLVED":
    res
      .status(409)
      .json({ error: "This support session is already resolved." });
    return;
  case "SESSION_ESCALATED":
    res
      .status(409)
      .json({ error: "Session escalated to human support. Use live chat." });
    return;
  case "SESSION_NOT_AI_ACTIVE":
    res.status(409).json({ error: "Session is not in AI mode." });
    return;
  case "LIVE_CHAT_NOT_AVAILABLE":
    res.status(403).json({
      error:
        "Human agent chat is available on Grow, Scale, and Enterprise plans " +
        "(Scale trial includes agent chat). Upgrade to unlock live help.",
    });
    return;
  default:
    logger.error("support-chat-handler", e);
    res.status(500).json({ error: "Support request failed." });
  }
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * GET /business/:businessId/support/session — active AI support session + messages.
 */
export const getSupportSession = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await SupportChatService.getOrCreateActiveSession(
      businessId,
      user.uid,
    );
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * GET /business/:businessId/support/session/:sessionId
 */
export const getSupportSessionById = async (req: Request, res: Response) => {
  const { businessId, sessionId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !sessionId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await SupportChatService.getSession(
      businessId,
      sessionId,
      user.uid,
    );
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/messages
 * Optional `attachments`: { url, fileName?, mimeType? }[] (max 4, https URLs from our file upload).
 */
export const postSupportMessage = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId, text, attachments } = req.body as {
    sessionId?: string;
    text?: string;
    attachments?: Array<{ url?: string; fileName?: string; mimeType?: string }>;
  };
  if (!businessId || !user?.uid || !sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const messageText = typeof text === "string" ? text : "";
  const atts = Array.isArray(attachments) ?
    attachments
      .filter(
        (a) => a && typeof a.url === "string" && a.url.startsWith("https://"),
      )
      .slice(0, 4)
      .map((a) => ({
        url: a.url as string,
        fileName: a.fileName,
        mimeType: a.mimeType,
      })) :
    [];

  if (!messageText.trim() && atts.length === 0) {
    res
      .status(400)
      .json({ error: "Message text or at least one attachment is required" });
    return;
  }

  try {
    const result = await SupportChatService.sendUserMessage(
      businessId,
      sessionId,
      user.uid,
      messageText,
      atts.length ? atts : undefined,
    );
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/satisfaction
 */
export const postSupportSatisfaction = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId, satisfied, storeKnowledge } = req.body as {
    sessionId?: string;
    satisfied?: boolean;
    storeKnowledge?: boolean;
  };
  if (
    !businessId ||
    !user?.uid ||
    !sessionId ||
    typeof satisfied !== "boolean"
  ) {
    res.status(400).json({ error: "sessionId and satisfied are required" });
    return;
  }
  try {
    const result = await SupportChatService.recordSatisfaction(
      businessId,
      sessionId,
      user.uid,
      {
        satisfied,
        storeKnowledge: storeKnowledge !== false,
      },
    );
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/escalate
 */
export const postSupportEscalate = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId } = req.body as { sessionId?: string };
  if (!businessId || !user?.uid || !sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  try {
    const session = await SupportChatService.escalateToHuman(
      businessId,
      sessionId,
      user.uid,
    );
    res.json({ data: { session } });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/presence/ack — user still here (no AI credit).
 */
export const postSupportPresenceAck = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId } = req.body as { sessionId?: string };
  if (!businessId || !user?.uid || !sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  try {
    const messages = await SupportChatService.acknowledgePresence(
      businessId,
      sessionId,
      user.uid,
    );
    res.json({ data: { messages } });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/presence/end — inactive timeout or user tapped "not
   here".
 */
export const postSupportPresenceEnd = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId, reason } = req.body as {
    sessionId?: string;
    reason?: "inactive_timeout" | "user_away";
  };
  if (
    !businessId ||
    !user?.uid ||
    !sessionId ||
    (reason !== "inactive_timeout" && reason !== "user_away")
  ) {
    res
      .status(400)
      .json({
        error:
          "sessionId and reason (inactive_timeout | user_away) are required",
      });
    return;
  }
  try {
    const session = await SupportChatService.endPresenceSession(
      businessId,
      sessionId,
      user.uid,
      reason,
    );
    res.json({ data: { session } });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/feedback — optional rating + comment after session
   ends.
 */
export const postSupportFeedback = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId, rating, comment, skipped } = req.body as {
    sessionId?: string;
    rating?: number | null;
    comment?: string | null;
    skipped?: boolean;
  };
  if (!businessId || !user?.uid || !sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  try {
    const session = await SupportChatService.submitFeedback(
      businessId,
      sessionId,
      user.uid,
      {
        rating,
        comment,
        skipped,
      },
    );
    res.json({ data: { session } });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/new — close active session and start fresh.
 */
export const postSupportNewSession = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await SupportChatService.startNewSession(
      businessId,
      user.uid,
    );
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * POST /business/:businessId/support/session/resolve
 */
export const postSupportResolve = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { sessionId } = req.body as { sessionId?: string };
  if (!businessId || !user?.uid || !sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  try {
    const session = await SupportChatService.resolveSession(
      businessId,
      sessionId,
      user.uid,
    );
    res.json({ data: { session } });
  } catch (e) {
    mapError(res, e);
  }
};
