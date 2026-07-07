import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { checkBusinessAccess } from "../utils/auth-utils";
import {
  findDeliveryChatThreadByReference,
  listDeliveryChatMessages,
  listDeliveryChatsForBusiness,
  markDeliveryChatThreadRead,
  sendStationDeliveryChatReply,
} from "../services/meta/delivery-messenger-chat-service";
import { sumDeliveryChatUnreadForBusiness } from "../services/notifications/delivery-messenger-chat-push-service";

async function requireBusinessMember(req: Request, res: Response): Promise<{
  uid: string;
  businessId: string;
  memberName: string;
} | null> {
  const user = (req as { user?: { uid?: string; name?: string } }).user;
  const businessId = String(req.params.businessId || "").trim();
  if (!user?.uid || !businessId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const { hasAccess, businessDoc } = await checkBusinessAccess(user.uid, businessId);
  if (!hasAccess || !businessDoc) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  const memberName = String(
    user.name || businessDoc.data()?.name || "Station",
  ).trim();

  return { uid: user.uid, businessId, memberName };
}

export async function listDeliveryMessengerChatsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  try {
    const threads = await listDeliveryChatsForBusiness(auth.businessId, 50);
    res.json({ data: threads });
  } catch (error) {
    logger.error("listDeliveryMessengerChatsHandler failed", error);
    res.status(500).json({ error: "Failed to load delivery chats" });
  }
}

export async function listDeliveryMessengerChatMessagesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  const threadId = String(req.params.threadId || "").trim();
  if (!threadId) {
    res.status(400).json({ error: "threadId required" });
    return;
  }

  try {
    const { getDeliveryChatThread } = await import(
      "../services/meta/delivery-messenger-chat-service"
    );
    const thread = await getDeliveryChatThread(threadId);
    if (!thread || thread.businessId !== auth.businessId) {
      res.status(404).json({ error: "thread_not_found" });
      return;
    }

    const messages = await listDeliveryChatMessages(threadId, 100);
    res.json({ data: messages });
  } catch (error) {
    logger.error("listDeliveryMessengerChatMessagesHandler failed", error);
    res.status(500).json({ error: "Failed to load messages" });
  }
}

export async function postDeliveryMessengerChatReplyHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  const threadId = String(req.params.threadId || "").trim();
  const text = String((req.body as { text?: string })?.text || "").trim();
  if (!threadId || !text) {
    res.status(400).json({ error: "threadId and text required" });
    return;
  }

  try {
    const { getDeliveryChatThread } = await import(
      "../services/meta/delivery-messenger-chat-service"
    );
    const thread = await getDeliveryChatThread(threadId);
    if (!thread || thread.businessId !== auth.businessId) {
      res.status(404).json({ error: "thread_not_found" });
      return;
    }

    const result = await sendStationDeliveryChatReply({
      threadId,
      text,
      sentByUid: auth.uid,
      sentByName: auth.memberName,
    });
    if (!result.ok) {
      res.status(result.reason === "thread_not_found" ? 404 : 400).json({
        error: result.reason ?? "send_failed",
      });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error("postDeliveryMessengerChatReplyHandler failed", error);
    res.status(500).json({ error: "Failed to send reply" });
  }
}

export async function getDeliveryMessengerChatUnreadCountHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  try {
    const unreadCount = await sumDeliveryChatUnreadForBusiness(auth.businessId);
    res.json({ data: { unreadCount } });
  } catch (error) {
    logger.error("getDeliveryMessengerChatUnreadCountHandler failed", error);
    res.status(500).json({ error: "Failed to load unread count" });
  }
}

export async function getDeliveryMessengerChatByReferenceHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  const referenceId = String(req.params.referenceId || "").trim();
  if (!referenceId) {
    res.status(400).json({ error: "referenceId required" });
    return;
  }

  try {
    const thread = await findDeliveryChatThreadByReference(auth.businessId, referenceId);
    res.json({ data: thread });
  } catch (error) {
    logger.error("getDeliveryMessengerChatByReferenceHandler failed", error);
    res.status(500).json({ error: "Failed to load thread" });
  }
}

export async function postDeliveryMessengerChatMarkReadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const auth = await requireBusinessMember(req, res);
  if (!auth) return;

  const threadId = String(req.params.threadId || "").trim();
  if (!threadId) {
    res.status(400).json({ error: "threadId required" });
    return;
  }

  try {
    const ok = await markDeliveryChatThreadRead({
      threadId,
      businessId: auth.businessId,
    });
    if (!ok) {
      res.status(404).json({ error: "thread_not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error("postDeliveryMessengerChatMarkReadHandler failed", error);
    res.status(500).json({ error: "Failed to mark read" });
  }
}
