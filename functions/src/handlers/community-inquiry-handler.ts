import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { isSalesPortalOpsUser } from "../services/meta/community-dispatch-ops-notify-service";
import {
  listCommunityInquiryMessages,
  listCommunityInquiryThreads,
  sendCommunityInquiryAdminReply,
} from "../services/meta/community-messenger-inquiry-service";

async function requireOpsUser(req: Request, res: Response): Promise<string | null> {
  const user = (req as { user?: { uid?: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!(await isSalesPortalOpsUser(user.uid))) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user.uid;
}

export async function listCommunityInquiryThreadsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = await requireOpsUser(req, res);
  if (!uid) return;

  try {
    const threads = await listCommunityInquiryThreads(50);
    res.json({ data: threads });
  } catch (error) {
    logger.error("listCommunityInquiryThreadsHandler failed", error);
    res.status(500).json({ error: "Failed to load inquiry threads" });
  }
}

export async function listCommunityInquiryMessagesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = await requireOpsUser(req, res);
  if (!uid) return;

  const { threadId } = req.params;
  if (!threadId?.trim()) {
    res.status(400).json({ error: "Missing threadId" });
    return;
  }

  try {
    const messages = await listCommunityInquiryMessages(threadId.trim(), 100);
    res.json({ data: messages });
  } catch (error) {
    logger.error("listCommunityInquiryMessagesHandler failed", error);
    res.status(500).json({ error: "Failed to load messages" });
  }
}

export async function postCommunityInquiryReplyHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const uid = await requireOpsUser(req, res);
  if (!uid) return;

  const { threadId } = req.params;
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!threadId?.trim() || !text) {
    res.status(400).json({ error: "Missing threadId or text" });
    return;
  }

  try {
    const result = await sendCommunityInquiryAdminReply({
      threadId: threadId.trim(),
      text,
      sentByUid: uid,
    });
    if (!result.ok) {
      const status = result.reason === "thread_not_found" ? 404 : 502;
      res.status(status).json({ error: result.reason });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("postCommunityInquiryReplyHandler failed", error);
    res.status(500).json({ error: "Failed to send reply" });
  }
}
