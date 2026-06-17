import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import {
  deleteTeamChatMessage,
  listTeamChatDirectory,
  listTeamChatMessages,
  markTeamChatRead,
  sendTeamChatMessage,
  setTeamChatMessageReaction,
} from "../services/team/team-chat-service";
import { isTeamChatReaction } from "../services/team/team-chat-reactions";
import type { TeamChatReactionType } from "../services/team/team-chat-types";
import { db } from "../config/firebase-admin";

function mapError(res: Response, e: unknown): void {
  const msg = e instanceof Error ? e.message : "Unknown error";
  switch (msg) {
  case "EMPTY_MESSAGE":
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  case "INVALID_PEER":
    res.status(400).json({ error: "Invalid teammate." });
    return;
  case "PEER_NOT_FOUND":
    res.status(404).json({ error: "Teammate not found or inactive." });
    return;
  case "FORBIDDEN":
    res.status(403).json({ error: "Forbidden." });
    return;
  case "CONVERSATION_NOT_FOUND":
    res.status(404).json({ error: "Conversation not found." });
    return;
  case "MESSAGE_NOT_FOUND":
    res.status(404).json({ error: "Message not found." });
    return;
  case "MESSAGE_DELETED":
    res.status(410).json({ error: "Message was deleted." });
    return;
  case "NOT_SENDER":
    res.status(403).json({ error: "You can only delete your own messages." });
    return;
  case "INVALID_REACTION":
    res.status(400).json({ error: "Invalid reaction." });
    return;
  default:
    logger.error("team-chat-handler", e);
    res.status(500).json({ error: "Team chat request failed." });
  }
}

async function resolveSenderName(
  businessId: string,
  userId: string,
  fallback?: string,
): Promise<string> {
  const memberSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(userId)
    .get();
  const memberName = memberSnap.data()?.name || memberSnap.data()?.displayName;
  if (typeof memberName === "string" && memberName.trim()) {
    return memberName.trim();
  }
  const businessSnap = await db.collection("businesses").doc(businessId).get();
  if (businessSnap.data()?.ownerId === userId) {
    return String(businessSnap.data()?.name || fallback || "Station owner");
  }
  return fallback?.trim() || "Team member";
}

export const getTeamChats = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const data = await listTeamChatDirectory(businessId, user.uid);
    res.json({ data });
  } catch (e) {
    mapError(res, e);
  }
};

export const getTeamChatMessages = async (req: Request, res: Response) => {
  const { businessId, conversationId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !conversationId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const messages = await listTeamChatMessages(
      businessId,
      user.uid,
      conversationId,
    );
    res.json({ data: { messages } });
  } catch (e) {
    mapError(res, e);
  }
};

export const postTeamChatRead = async (req: Request, res: Response) => {
  const { businessId, conversationId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !conversationId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    await markTeamChatRead(businessId, user.uid, conversationId);
    res.json({ data: { ok: true } });
  } catch (e) {
    mapError(res, e);
  }
};

export const postTeamChatMessage = async (req: Request, res: Response) => {
  const { businessId, peerUserId } = req.params;
  const user = (
    req as { user?: { uid: string; name?: string; displayName?: string } }
  ).user;
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const attachments = Array.isArray(req.body?.attachments) ?
    req.body.attachments :
    undefined;
  if (!businessId || !peerUserId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const senderName = await resolveSenderName(
      businessId,
      user.uid,
      user.displayName || user.name,
    );
    const result = await sendTeamChatMessage({
      businessId,
      senderId: user.uid,
      senderName,
      peerUserId,
      text,
      attachments,
    });
    res.json({ data: result });
  } catch (e) {
    mapError(res, e);
  }
};

export const postTeamChatMessageReaction = async (req: Request, res: Response) => {
  const { businessId, conversationId, messageId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !conversationId || !messageId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const rawReaction = req.body?.reaction;
  let reaction: TeamChatReactionType | null = null;
  if (rawReaction === null || rawReaction === undefined || rawReaction === "") {
    reaction = null;
  } else if (isTeamChatReaction(rawReaction)) {
    reaction = rawReaction;
  } else {
    res.status(400).json({ error: "Invalid reaction." });
    return;
  }

  try {
    const message = await setTeamChatMessageReaction({
      businessId,
      userId: user.uid,
      conversationId,
      messageId,
      reaction,
    });
    res.json({ data: { message } });
  } catch (e) {
    mapError(res, e);
  }
};

export const deleteTeamChatMessageHandler = async (req: Request, res: Response) => {
  const { businessId, conversationId, messageId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !conversationId || !messageId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    await deleteTeamChatMessage({
      businessId,
      userId: user.uid,
      conversationId,
      messageId,
    });
    res.json({ data: { ok: true } });
  } catch (e) {
    mapError(res, e);
  }
};
