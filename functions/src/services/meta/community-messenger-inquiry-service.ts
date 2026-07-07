import { db, FieldValue } from "../../config/firebase-admin";
import type { CommunityChannelContact } from "./community-channel-contact";
import { channelContactFields } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import { parseCommunityOrderTemplate } from "./community-dispatch-template-parser";

const THREADS_COLLECTION = "community_messenger_inquiry_threads";

export type CommunityInquiryMessageDirection = "inbound" | "outbound";

export type CommunityInquiryThreadDoc = {
  sourceChannel: CommunityChannelContact["sourceChannel"];
  channelContactId: string;
  metaPsid?: string;
  whatsappWaId?: string;
  viberUserId?: string;
  status: "open" | "closed";
  unreadCount: number;
  /** True when latest inbound looks like a water order — for admin visibility. */
  orderLikeMessage?: boolean;
  lastCustomerMessageAt?: FirebaseFirestore.FieldValue;
  lastAdminMessageAt?: FirebaseFirestore.FieldValue;
  lastMessagePreview?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
};

export type CommunityInquiryMessageDoc = {
  direction: CommunityInquiryMessageDirection;
  text: string;
  metaMessageId?: string;
  sentByUid?: string;
  createdAt?: FirebaseFirestore.FieldValue;
};

function threadIdFor(contact: CommunityChannelContact): string {
  return `${contact.sourceChannel}:${contact.contactId}`;
}

function threadRef(contact: CommunityChannelContact) {
  return db.collection(THREADS_COLLECTION).doc(threadIdFor(contact));
}

/** Customer text in inquiry that looks like an order form or order line. */
export function looksLikeCommunityInquiryOrderMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const parsed = parseCommunityOrderTemplate(trimmed);
  if (parsed.looksLikeTemplate) return true;

  const lower = trimmed.toLowerCase();
  const hasOrderLabel = /\border\s*:/i.test(trimmed);
  const hasContainerWater =
    /\b(slim|round)\b/.test(lower) &&
    /\b(alkaline|mineral|purified)\b/.test(lower);
  const hasQtyPattern = /\d+\s+(slim|round)\s*-\s*(alkaline|mineral|purified)/i.test(trimmed);

  return hasOrderLabel || hasQtyPattern || (hasContainerWater && /\d/.test(trimmed));
}

export async function ensureCommunityInquiryThreadOpen(
  contact: CommunityChannelContact,
): Promise<string> {
  const id = threadIdFor(contact);
  const ref = db.collection(THREADS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      ...channelContactFields(contact),
      status: "open",
      unreadCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies CommunityInquiryThreadDoc);
  } else {
    await ref.set(
      {
        status: "open",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  return id;
}

/** Store customer message — no automated bot reply in inquiry mode. */
export async function recordCommunityInquiryInboundMessage(params: {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
}): Promise<void> {
  const preview = params.text.trim().slice(0, 240);
  if (!preview) return;

  await ensureCommunityInquiryThreadOpen(params.contact);
  const ref = threadRef(params.contact);

  await ref.collection("messages").add({
    direction: "inbound",
    text: preview,
    ...(params.metaMessageId ? { metaMessageId: params.metaMessageId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  } satisfies CommunityInquiryMessageDoc);

  await ref.set(
    {
      unreadCount: FieldValue.increment(1),
      lastCustomerMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      orderLikeMessage: looksLikeCommunityInquiryOrderMessage(params.text),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function sendCommunityInquiryAdminReply(params: {
  threadId: string;
  text: string;
  sentByUid: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const snap = await db.collection(THREADS_COLLECTION).doc(params.threadId).get();
  if (!snap.exists) {
    return { ok: false, reason: "thread_not_found" };
  }

  const thread = snap.data() as CommunityInquiryThreadDoc;
  const contactId = thread.channelContactId?.trim();
  const sourceChannel = thread.sourceChannel ?? "community_messenger";
  if (!contactId) {
    return { ok: false, reason: "invalid_thread" };
  }

  const contact: CommunityChannelContact = {
    sourceChannel,
    contactId,
  };

  const body = params.text.trim().slice(0, 2000);
  if (!body) {
    return { ok: false, reason: "empty_message" };
  }

  const sendResult = await sendCommunityChannelText(contact, body);
  if (!sendResult.ok) {
    return { ok: false, reason: sendResult.reason };
  }

  await snap.ref.collection("messages").add({
    direction: "outbound",
    text: body,
    sentByUid: params.sentByUid,
    createdAt: FieldValue.serverTimestamp(),
  } satisfies CommunityInquiryMessageDoc);

  await snap.ref.set(
    {
      unreadCount: 0,
      lastAdminMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: body,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
}

export async function listCommunityInquiryThreads(limit = 50): Promise<
  Array<CommunityInquiryThreadDoc & { id: string }>
> {
  const snap = await db
    .collection(THREADS_COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as CommunityInquiryThreadDoc),
    }))
    .filter((row) => row.status === "open");
}

export async function listCommunityInquiryMessages(
  threadId: string,
  limit = 100,
): Promise<Array<CommunityInquiryMessageDoc & { id: string }>> {
  const snap = await db
    .collection(THREADS_COLLECTION)
    .doc(threadId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as CommunityInquiryMessageDoc),
  }));
}
