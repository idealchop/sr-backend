import type { DocumentSnapshot } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { listTeamMembers } from "./team-hub-service";
import { maskTeamChatProfanity } from "./team-chat-profanity-filter";
import { TEAM_CHAT_RETENTION_DAYS } from "./team-chat-retention";
import { TEAM_CHAT_REACTIONS } from "./team-chat-reactions";
import type {
  TeamChatConversationDto,
  TeamChatDirectoryDto,
  TeamChatMessageAttachmentDto,
  TeamChatMessageDto,
  TeamChatMessageReactionsDto,
  TeamChatReactionType,
} from "./team-chat-types";

const TEAM_CHATS = "team_chats";
const MESSAGES = "messages";
const MAX_ATTACHMENTS = 1;

function sanitizeTeamChatAttachments(
  input?: TeamChatMessageAttachmentDto[],
): TeamChatMessageAttachmentDto[] {
  if (!input?.length) return [];
  return input
    .slice(0, MAX_ATTACHMENTS)
    .filter((a) => typeof a.url === "string" && a.url.startsWith("https://"))
    .map((a) => ({
      url: a.url,
      fileName: typeof a.fileName === "string" ? a.fileName.slice(0, 200) : undefined,
      mimeType: typeof a.mimeType === "string" ? a.mimeType.slice(0, 100) : undefined,
    }));
}

function buildLastMessagePreview(
  text: string,
  attachments: TeamChatMessageAttachmentDto[],
): string {
  const trimmed = text.trim();
  if (trimmed && attachments.length > 0) {
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }
  if (trimmed) {
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }
  if (attachments.length > 0) return "📷 Photo";
  return "Start a conversation";
}

function serializeAttachments(value: unknown): TeamChatMessageAttachmentDto[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const rows: TeamChatMessageAttachmentDto[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url.startsWith("https://")) continue;
    rows.push({
      url,
      fileName: typeof row.fileName === "string" ? row.fileName : undefined,
      mimeType: typeof row.mimeType === "string" ? row.mimeType : undefined,
    });
  }
  return rows.length ? rows : undefined;
}

function serializeReactions(value: unknown): TeamChatMessageReactionsDto | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: TeamChatMessageReactionsDto = {};
  for (const type of TEAM_CHAT_REACTIONS) {
    const arr = raw[type];
    if (!Array.isArray(arr)) continue;
    const uids = arr.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (uids.length) out[type] = uids;
  }
  return Object.keys(out).length ? out : undefined;
}

function serializeMessage(doc: DocumentSnapshot): TeamChatMessageDto {
  const d = doc.data() || {};
  const deleted = Boolean(d.deletedAt);
  return {
    id: doc.id,
    senderId: String(d.senderId || ""),
    senderName: String(d.senderName || "Member"),
    text: deleted ? "" : String(d.text || ""),
    createdAt: serializeTimestamp(d.createdAt) || new Date().toISOString(),
    attachments: deleted ? undefined : serializeAttachments(d.attachments),
    reactions: serializeReactions(d.reactions),
    deleted,
  };
}

export async function refreshConversationPreview(
  convRef: FirebaseFirestore.DocumentReference,
): Promise<void> {
  const snap = await convRef
    .collection(MESSAGES)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.deletedAt) continue;
    const text = String(d.text || "");
    const attachments = serializeAttachments(d.attachments) || [];
    await convRef.update({
      lastMessageText: buildLastMessagePreview(text, attachments),
      lastMessageSenderId: String(d.senderId || ""),
      lastMessageAt: d.createdAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  await convRef.update({
    lastMessageText: "Start a conversation",
    lastMessageSenderId: FieldValue.delete(),
    lastMessageAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function buildConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join("_");
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function serializeTimestamp(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

const GENERIC_TEAM_NAMES = new Set([
  "owner",
  "member",
  "team member",
  "station owner",
  "verified user",
]);

type PeerDirectoryEntry = {
  name: string;
  initials: string;
  role: string;
};

function isGenericTeamDisplayName(name: string | undefined | null): boolean {
  if (!name?.trim()) return true;
  return GENERIC_TEAM_NAMES.has(name.trim().toLowerCase());
}

function normalizePeerRole(role: string | undefined | null, ownerId: string, uid: string): string {
  if (uid === ownerId) return "owner";
  const r = String(role || "rider").toLowerCase();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "staff") return "rider";
  return r === "rider" ? "rider" : r;
}

async function resolveUserDisplayName(
  uid: string,
  fallback?: string,
): Promise<string> {
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data();
  const candidates = [
    typeof userData?.fullName === "string" ? userData.fullName.trim() : "",
    typeof userData?.displayName === "string" ? userData.displayName.trim() : "",
    fallback?.trim() || "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isGenericTeamDisplayName(candidate)) return candidate;
  }

  return candidates[0] || "Team member";
}

async function resolvePeerDirectory(
  businessId: string,
  userId: string,
): Promise<Map<string, PeerDirectoryEntry>> {
  const businessSnap = await db.collection("businesses").doc(businessId).get();
  const ownerId = String(businessSnap.data()?.ownerId || "");
  const members = await listTeamMembers(businessId);
  const peers = new Map<string, PeerDirectoryEntry>();

  for (const member of members) {
    const uid = member.userId || member.id;
    if (!uid || uid === userId) continue;
    if (!member.isActive && String(member.role || "").toLowerCase() !== "owner") {
      continue;
    }
    const role = normalizePeerRole(member.role, ownerId, uid);
    const rawName = member.name?.trim() || "Team member";
    const name = isGenericTeamDisplayName(rawName) ?
      await resolveUserDisplayName(uid, rawName) :
      rawName;
    peers.set(uid, { name, initials: initialsForName(name), role });
  }

  if (ownerId && ownerId !== userId && !peers.has(ownerId)) {
    const ownerMember = members.find((m) => (m.userId || m.id) === ownerId);
    const rawName =
      ownerMember?.name?.trim() ||
      String(businessSnap.data()?.name || "Station owner");
    const name = isGenericTeamDisplayName(rawName) ?
      await resolveUserDisplayName(ownerId, rawName) :
      rawName;
    peers.set(ownerId, {
      name,
      initials: initialsForName(name),
      role: "owner",
    });
  }

  return peers;
}

function resolveConversationTitle(
  storedTitle: unknown,
  peer: PeerDirectoryEntry | undefined,
): string {
  const fromChat = typeof storedTitle === "string" ? storedTitle.trim() : "";
  if (fromChat && !isGenericTeamDisplayName(fromChat)) return fromChat;
  return peer?.name || "Team member";
}

function peerSortRank(role: string | undefined): number {
  const r = String(role || "").toLowerCase();
  if (r === "owner") return 0;
  if (r === "admin") return 1;
  return 2;
}

function assertParticipant(userId: string, participantIds: unknown): void {
  if (!Array.isArray(participantIds) || !participantIds.includes(userId)) {
    throw new Error("FORBIDDEN");
  }
}

function unreadCountForUser(data: Record<string, unknown> | undefined, userId: string): number {
  const map = data?.unreadCountByUser as Record<string, unknown> | undefined;
  const value = map?.[userId];
  return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
}

export async function markTeamChatRead(
  businessId: string,
  userId: string,
  conversationId: string,
): Promise<void> {
  const convRef = db
    .collection("businesses")
    .doc(businessId)
    .collection(TEAM_CHATS)
    .doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) return;

  assertParticipant(userId, convSnap.data()?.participantIds);
  await convRef.update({
    [`unreadCountByUser.${userId}`]: 0,
    [`readAtByUser.${userId}`]: FieldValue.serverTimestamp(),
  });
}

export async function listTeamChatDirectory(
  businessId: string,
  userId: string,
): Promise<TeamChatDirectoryDto> {
  const peers = await resolvePeerDirectory(businessId, userId);
  const chatsSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection(TEAM_CHATS)
    .where("participantIds", "array-contains", userId)
    .get();

  const byPeer = new Map<string, TeamChatConversationDto>();

  for (const doc of chatsSnap.docs) {
    const data = doc.data();
    const participantIds = data.participantIds as string[];
    const peerUserId = participantIds.find((id) => id !== userId);
    if (!peerUserId) continue;
    const peer = peers.get(peerUserId);
    const title = resolveConversationTitle(data.peerTitles?.[userId], peer);
    byPeer.set(peerUserId, {
      id: doc.id,
      peerUserId,
      title,
      initials: String(data.peerInitials?.[peerUserId] || peer?.initials || "?"),
      preview: String(data.lastMessageText || "Start a conversation"),
      lastMessageAt: serializeTimestamp(data.lastMessageAt),
      peerRole: peer?.role || "rider",
      unreadCount: unreadCountForUser(data, userId),
    });
  }

  const conversations: TeamChatConversationDto[] = [];

  for (const [peerUserId, peer] of peers.entries()) {
    const existing = byPeer.get(peerUserId);
    if (existing) {
      conversations.push({
        ...existing,
        title: peer.name,
        initials: peer.initials,
        peerRole: peer.role,
      });
      continue;
    }
    conversations.push({
      id: buildConversationId(userId, peerUserId),
      peerUserId,
      title: peer.name,
      initials: peer.initials,
      preview: "Start a conversation",
      lastMessageAt: null,
      peerRole: peer.role,
      unreadCount: 0,
    });
  }

  conversations.sort((a, b) => {
    const unreadDiff = (b.unreadCount ?? 0) - (a.unreadCount ?? 0);
    if (unreadDiff !== 0) return unreadDiff;
    const roleDiff = peerSortRank(a.peerRole) - peerSortRank(b.peerRole);
    if (roleDiff !== 0) return roleDiff;
    const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });

  const totalUnreadCount = conversations.reduce(
    (sum, row) => sum + (row.unreadCount ?? 0),
    0,
  );

  return {
    conversations,
    totalUnreadCount,
    retentionDays: TEAM_CHAT_RETENTION_DAYS,
  };
}

export async function listTeamChatMessages(
  businessId: string,
  userId: string,
  conversationId: string,
): Promise<TeamChatMessageDto[]> {
  const convRef = db
    .collection("businesses")
    .doc(businessId)
    .collection(TEAM_CHATS)
    .doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) return [];

  assertParticipant(userId, convSnap.data()?.participantIds);

  const snap = await convRef
    .collection(MESSAGES)
    .orderBy("createdAt", "asc")
    .limit(200)
    .get();

  return snap.docs.map((doc) => serializeMessage(doc));
}

export async function setTeamChatMessageReaction(params: {
  businessId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  reaction: TeamChatReactionType | null;
}): Promise<TeamChatMessageDto> {
  const convRef = db
    .collection("businesses")
    .doc(params.businessId)
    .collection(TEAM_CHATS)
    .doc(params.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw new Error("CONVERSATION_NOT_FOUND");

  assertParticipant(params.userId, convSnap.data()?.participantIds);

  const messageRef = convRef.collection(MESSAGES).doc(params.messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) throw new Error("MESSAGE_NOT_FOUND");

  const messageData = messageSnap.data() || {};
  if (messageData.deletedAt) throw new Error("MESSAGE_DELETED");

  const existing = serializeReactions(messageData.reactions) || {};
  const next: TeamChatMessageReactionsDto = {};

  for (const type of TEAM_CHAT_REACTIONS) {
    const uids = (existing[type] || []).filter((id) => id !== params.userId);
    if (uids.length) next[type] = uids;
  }

  if (params.reaction) {
    next[params.reaction] = [...(next[params.reaction] || []), params.userId];
  }

  const reactionsPayload: Record<string, string[]> = {};
  for (const type of TEAM_CHAT_REACTIONS) {
    const uids = next[type];
    if (uids?.length) reactionsPayload[type] = uids;
  }

  await messageRef.update({
    reactions: reactionsPayload,
  });

  const updated = await messageRef.get();
  return serializeMessage(updated);
}

export async function deleteTeamChatMessage(params: {
  businessId: string;
  userId: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const convRef = db
    .collection("businesses")
    .doc(params.businessId)
    .collection(TEAM_CHATS)
    .doc(params.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw new Error("CONVERSATION_NOT_FOUND");

  assertParticipant(params.userId, convSnap.data()?.participantIds);

  const messageRef = convRef.collection(MESSAGES).doc(params.messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) throw new Error("MESSAGE_NOT_FOUND");

  const messageData = messageSnap.data() || {};
  if (messageData.deletedAt) return;
  if (String(messageData.senderId || "") !== params.userId) throw new Error("NOT_SENDER");

  await messageRef.update({
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: params.userId,
    text: "",
    attachments: FieldValue.delete(),
  });

  const convData = convSnap.data();
  const wasLastMessage =
    serializeTimestamp(convData?.lastMessageAt) ===
    serializeTimestamp(messageData.createdAt);

  if (wasLastMessage) {
    await refreshConversationPreview(convRef);
  }
}

export async function sendTeamChatMessage(params: {
  businessId: string;
  senderId: string;
  senderName: string;
  peerUserId: string;
  text: string;
  attachments?: TeamChatMessageAttachmentDto[];
}): Promise<{ conversationId: string; message: TeamChatMessageDto }> {
  const rawText = params.text.trim();
  const attachments = sanitizeTeamChatAttachments(params.attachments);
  if (!rawText && attachments.length === 0) throw new Error("EMPTY_MESSAGE");
  if (params.senderId === params.peerUserId) throw new Error("INVALID_PEER");

  const text = rawText ? await maskTeamChatProfanity(rawText) : "";

  const peers = await resolvePeerDirectory(params.businessId, params.senderId);
  const peer = peers.get(params.peerUserId);
  if (!peer) throw new Error("PEER_NOT_FOUND");

  const conversationId = buildConversationId(params.senderId, params.peerUserId);
  const convRef = db
    .collection("businesses")
    .doc(params.businessId)
    .collection(TEAM_CHATS)
    .doc(conversationId);

  const now = FieldValue.serverTimestamp();
  const messageRef = convRef.collection(MESSAGES).doc();
  const preview = buildLastMessagePreview(text, attachments);

  await db.runTransaction(async (tx) => {
    const convSnap = await tx.get(convRef);
    const participantIds = [params.senderId, params.peerUserId].sort();
    const peerTitles = {
      [params.senderId]: peer.name,
      [params.peerUserId]: params.senderName,
    };
    const peerInitials = {
      [params.peerUserId]: peer.initials,
      [params.senderId]: initialsForName(params.senderName),
    };

    if (!convSnap.exists) {
      tx.set(convRef, {
        participantIds,
        peerTitles,
        peerInitials,
        lastMessageText: preview,
        lastMessageSenderId: params.senderId,
        lastMessageAt: now,
        unreadCountByUser: {
          [params.peerUserId]: 1,
          [params.senderId]: 0,
        },
        createdAt: now,
        updatedAt: now,
      });
    } else {
      tx.update(convRef, {
        peerTitles,
        peerInitials,
        lastMessageText: preview,
        lastMessageSenderId: params.senderId,
        lastMessageAt: now,
        [`unreadCountByUser.${params.peerUserId}`]: FieldValue.increment(1),
        updatedAt: now,
      });
    }

    tx.set(messageRef, {
      senderId: params.senderId,
      senderName: params.senderName,
      text,
      ...(attachments.length ? { attachments } : {}),
      createdAt: now,
    });
  });

  const saved = await messageRef.get();
  const createdAt = serializeTimestamp(saved.data()?.createdAt) || new Date().toISOString();

  return {
    conversationId,
    message: {
      id: messageRef.id,
      senderId: params.senderId,
      senderName: params.senderName,
      text,
      createdAt,
      attachments: attachments.length ? attachments : undefined,
    },
  };
}
