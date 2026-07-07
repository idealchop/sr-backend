import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { sendMetaMessengerText } from "./meta-messenger-send-service";
import type { CommunityChannelContact } from "./community-channel-contact";
import { channelContactFields } from "./community-channel-contact";
import { buildCommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelText, sendCommunityChannelButtons } from "./community-channel-outbound-service";
import {
  COMMUNITY_DELIVERY_CHAT_HINT,
  buildCommunityDeliveryChatOpenedMessage,
  buildCommunityDeliveryChatClosedMessage,
  buildCommunityDeliveryChatClosedOnCompleteMessage,
  buildCommunityStationInitiatedChatMessage,
} from "./community-messenger-copy";
import type { AcceptedDeliveryChatContext } from "./community-active-order-guard-service";
import { listLinkedTeamMessengerPsids } from "../team/team-messenger-bridge-service";
import { sendDeliveryMessengerChatPush } from "../notifications/delivery-messenger-chat-push-service";
import { META_POSTBACK_DELIVERY_CHAT } from "./community-order-template";

const THREADS_COLLECTION = "delivery_messenger_chats";

export type DeliveryMessengerChatMessageDirection = "inbound" | "outbound";

export type DeliveryMessengerChatThreadDoc = {
  sourceChannel: CommunityChannelContact["sourceChannel"];
  channelContactId: string;
  metaPsid?: string;
  whatsappWaId?: string;
  viberUserId?: string;
  businessId: string;
  stationName: string;
  dispatchRequestId: string;
  referenceId: string;
  trackReferenceId?: string;
  customerName?: string;
  customerChatMode: boolean;
  unreadCountForStation: number;
  status: "open" | "closed";
  lastCustomerMessageAt?: FirebaseFirestore.FieldValue;
  lastStationMessageAt?: FirebaseFirestore.FieldValue;
  lastMessagePreview?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
};

export type DeliveryMessengerChatMessageDoc = {
  direction: DeliveryMessengerChatMessageDirection;
  text: string;
  metaMessageId?: string;
  sentByUid?: string;
  sentByName?: string;
  createdAt?: FirebaseFirestore.FieldValue;
};

export function threadIdForContact(contact: CommunityChannelContact): string {
  return `${contact.sourceChannel}:${contact.contactId}`;
}

function threadRef(threadId: string) {
  return db.collection(THREADS_COLLECTION).doc(threadId);
}

export function parseDeliveryChatCommand(text: string):
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "none" } {
  const upper = text.trim().toUpperCase();
  if (upper === "CHAT") return { kind: "open" };
  if (upper === "CLOSE CHAT" || upper === "CLOSECHAT") return { kind: "close" };
  return { kind: "none" };
}

export async function getDeliveryChatThread(
  threadId: string,
): Promise<(DeliveryMessengerChatThreadDoc & { id: string }) | null> {
  const snap = await threadRef(threadId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as DeliveryMessengerChatThreadDoc) };
}

async function ensureDeliveryChatThread(
  contact: CommunityChannelContact,
  context: AcceptedDeliveryChatContext,
): Promise<string> {
  const id = threadIdForContact(contact);
  const ref = threadRef(id);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      ...channelContactFields(contact),
      businessId: context.businessId,
      stationName: context.stationName,
      dispatchRequestId: context.requestId,
      referenceId: context.referenceId,
      ...(context.trackReferenceId ? { trackReferenceId: context.trackReferenceId } : {}),
      ...(context.customerName ? { customerName: context.customerName } : {}),
      customerChatMode: false,
      unreadCountForStation: 0,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies DeliveryMessengerChatThreadDoc);
  } else {
    await ref.set(
      {
        businessId: context.businessId,
        stationName: context.stationName,
        dispatchRequestId: context.requestId,
        referenceId: context.referenceId,
        ...(context.trackReferenceId ? { trackReferenceId: context.trackReferenceId } : {}),
        status: "open",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  return id;
}

export async function openCustomerDeliveryChat(params: {
  contact: CommunityChannelContact;
  context: AcceptedDeliveryChatContext;
}): Promise<void> {
  const threadId = await ensureDeliveryChatThread(params.contact, params.context);
  await threadRef(threadId).set(
    {
      customerChatMode: true,
      status: "open",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await sendCommunityChannelText(
    params.contact,
    buildCommunityDeliveryChatOpenedMessage({
      stationName: params.context.stationName,
      referenceId: params.context.trackReferenceId ?? params.context.referenceId,
    }),
  );

  await notifyStationDeliveryChatEvent({
    businessId: params.context.businessId,
    threadId,
    customerName: params.context.customerName ?? "Customer",
    referenceId: params.context.trackReferenceId ?? params.context.referenceId,
    kind: "customer_opened",
  });
}

export async function closeCustomerDeliveryChat(
  contact: CommunityChannelContact,
): Promise<boolean> {
  const threadId = threadIdForContact(contact);
  const thread = await getDeliveryChatThread(threadId);
  if (!thread?.customerChatMode) return false;

  await threadRef(threadId).set(
    {
      customerChatMode: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await sendCommunityChannelText(contact, buildCommunityDeliveryChatClosedMessage());
  return true;
}

export async function isCustomerDeliveryChatModeOpen(
  contact: CommunityChannelContact,
): Promise<boolean> {
  const thread = await getDeliveryChatThread(threadIdForContact(contact));
  return Boolean(thread?.customerChatMode && thread.status === "open");
}

export async function recordCustomerDeliveryChatMessage(params: {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
  context: AcceptedDeliveryChatContext;
}): Promise<void> {
  const preview = params.text.trim().slice(0, 240);
  if (!preview) return;

  const threadId = await ensureDeliveryChatThread(params.contact, params.context);
  const ref = threadRef(threadId);

  await ref.collection("messages").add({
    direction: "inbound",
    text: preview,
    ...(params.metaMessageId ? { metaMessageId: params.metaMessageId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  } satisfies DeliveryMessengerChatMessageDoc);

  await ref.set(
    {
      customerChatMode: true,
      status: "open",
      unreadCountForStation: FieldValue.increment(1),
      lastCustomerMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await notifyStationDeliveryChatEvent({
    businessId: params.context.businessId,
    threadId,
    customerName: params.context.customerName ?? "Customer",
    referenceId: params.context.trackReferenceId ?? params.context.referenceId,
    kind: "customer_message",
    preview,
  });
}

export async function sendStationDeliveryChatReply(params: {
  threadId: string;
  text: string;
  sentByUid: string;
  sentByName: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const body = params.text.trim().slice(0, 2000);
  if (!body) return { ok: false, reason: "empty_message" };

  const snap = await threadRef(params.threadId).get();
  if (!snap.exists) return { ok: false, reason: "thread_not_found" };

  const thread = snap.data() as DeliveryMessengerChatThreadDoc;
  const contact = buildCommunityChannelContact({
    sourceChannel: thread.sourceChannel,
    contactId: thread.channelContactId,
  });

  await threadRef(params.threadId).collection("messages").add({
    direction: "outbound",
    text: body,
    sentByUid: params.sentByUid,
    sentByName: params.sentByName,
    createdAt: FieldValue.serverTimestamp(),
  } satisfies DeliveryMessengerChatMessageDoc);

  await threadRef(params.threadId).set(
    {
      lastStationMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: body.slice(0, 240),
      unreadCountForStation: 0,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const prefix = `${thread.stationName}: `;
  const result = await sendCommunityChannelText(
    contact,
    `${prefix}${body}`.slice(0, 2000),
  );

  if (!result.ok) {
    logger.warn("sendStationDeliveryChatReply failed", {
      threadId: params.threadId,
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
}

export async function ownerInitiateDeliveryChat(params: {
  businessId: string;
  referenceToken: string;
  ownerUserId: string;
  ownerName: string;
}): Promise<{
  threadId: string;
  customerName: string;
  referenceId: string;
  contact: CommunityChannelContact;
}> {
  const resolved = await resolveDeliveryChatByReference(params.businessId, params.referenceToken);
  if (!resolved) {
    throw new Error("Hindi mahanap ang order. Gamitin ang reference (hal: TX-1042 o CR-ABC).");
  }

  const threadId = await ensureDeliveryChatThread(resolved.contact, resolved.context);
  await threadRef(threadId).set(
    {
      customerChatMode: true,
      status: "open",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const refLabel = resolved.context.trackReferenceId ?? resolved.context.referenceId;
  await sendCommunityChannelText(
    resolved.contact,
    buildCommunityStationInitiatedChatMessage({
      stationName: resolved.context.stationName,
      referenceId: refLabel,
    }),
  );

  return {
    threadId,
    customerName: resolved.context.customerName ?? "Customer",
    referenceId: refLabel,
    contact: resolved.contact,
  };
}

export async function ownerReplyToDeliveryChat(params: {
  threadId: string;
  businessId: string;
  ownerUserId: string;
  ownerName: string;
  text: string;
}): Promise<void> {
  const thread = await getDeliveryChatThread(params.threadId);
  if (!thread || thread.businessId !== params.businessId) {
    throw new Error("Chat thread not found for this station.");
  }

  const result = await sendStationDeliveryChatReply({
    threadId: params.threadId,
    text: params.text,
    sentByUid: params.ownerUserId,
    sentByName: params.ownerName,
  });
  if (!result.ok) {
    throw new Error("Could not send message to customer.");
  }
}

async function notifyStationDeliveryChatEvent(params: {
  businessId: string;
  threadId: string;
  customerName: string;
  referenceId: string;
  kind: "customer_opened" | "customer_message";
  preview?: string;
}): Promise<void> {
  const psids = await listLinkedTeamMessengerPsids(params.businessId);
  if (psids.length) {
    const body =
      params.kind === "customer_opened" ?
        [
          `💬 ${params.customerName} opened delivery chat (Ref: ${params.referenceId}).`,
          "I-send CHAT CUST {ref} para mag-reply.",
          `Hal: CHAT CUST ${params.referenceId}`,
        ].join("\n") :
        `💬 ${params.customerName} (${params.referenceId}): ${params.preview ?? ""}`.slice(0, 1900);

    await Promise.all(
      psids.map((psid) => sendMetaMessengerText(psid, body).catch(() => undefined)),
    );
  }

  if (params.kind === "customer_message" && params.preview) {
    void sendDeliveryMessengerChatPush({
      businessId: params.businessId,
      threadId: params.threadId,
      customerName: params.customerName,
      referenceId: params.referenceId,
      preview: params.preview,
    }).catch((error) => {
      logger.warn("delivery_messenger_chat_push_failed", { error, businessId: params.businessId });
    });
  }
}

export async function sendCommunityDeliveryChatDiscoveryButton(
  contact: CommunityChannelContact,
): Promise<void> {
  const result = await sendCommunityChannelButtons({
    contact,
    text: COMMUNITY_DELIVERY_CHAT_HINT,
    buttons: [{ title: "Chat station", payload: META_POSTBACK_DELIVERY_CHAT }],
  });
  if (!result.ok) {
    await sendCommunityChannelText(contact, COMMUNITY_DELIVERY_CHAT_HINT);
  }
}

export async function closeDeliveryChatOnOrderComplete(params: {
  businessId: string;
  referenceId: string;
}): Promise<void> {
  const token = params.referenceId.trim().toUpperCase();
  if (!token) return;

  const snap = await db
    .collection(THREADS_COLLECTION)
    .where("businessId", "==", params.businessId)
    .limit(100)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() as DeliveryMessengerChatThreadDoc;
    const ref = data.referenceId?.trim().toUpperCase() ?? "";
    const track = data.trackReferenceId?.trim().toUpperCase() ?? "";
    if (ref !== token && track !== token) continue;

    const wasActive = data.status === "open";
    await doc.ref.set(
      {
        status: "closed",
        customerChatMode: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (wasActive) {
      const contact = buildCommunityChannelContact({
        sourceChannel: data.sourceChannel,
        contactId: data.channelContactId,
      });
      await sendCommunityChannelText(
        contact,
        buildCommunityDeliveryChatClosedOnCompleteMessage({
          referenceId: params.referenceId,
        }),
      );
    }
  }
}

export async function markDeliveryChatThreadRead(params: {
  threadId: string;
  businessId: string;
}): Promise<boolean> {
  const thread = await getDeliveryChatThread(params.threadId);
  if (!thread || thread.businessId !== params.businessId) return false;

  await threadRef(params.threadId).set(
    { unreadCountForStation: 0, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return true;
}

export async function findDeliveryChatThreadByReference(
  businessId: string,
  referenceId: string,
): Promise<(DeliveryMessengerChatThreadDoc & { id: string }) | null> {
  const token = referenceId.trim().toUpperCase();
  if (!token) return null;

  const snap = await db
    .collection(THREADS_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(100)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() as DeliveryMessengerChatThreadDoc;
    const ref = data.referenceId?.trim().toUpperCase() ?? "";
    const track = data.trackReferenceId?.trim().toUpperCase() ?? "";
    if (ref === token || track === token) {
      return { id: doc.id, ...data };
    }
  }
  return null;
}

export async function resolveDeliveryChatByReference(
  businessId: string,
  referenceToken: string,
): Promise<{
  contact: CommunityChannelContact;
  context: AcceptedDeliveryChatContext;
} | null> {
  const token = referenceToken.trim().toUpperCase();
  if (!token) return null;

  const requestsSnap = await db
    .collection("community_dispatch_requests")
    .where("assignedBusinessId", "==", businessId)
    .where("status", "==", "accepted")
    .limit(50)
    .get();

  for (const doc of requestsSnap.docs) {
    const data = doc.data() as import("./community-dispatch-request-types").CommunityDispatchRequestDoc;
    const ref = data.referenceId?.trim().toUpperCase() ?? "";
    const track = data.submissionReferenceId?.trim().toUpperCase() ?? "";
    if (ref !== token && track !== token && !ref.includes(token) && !track.includes(token)) {
      continue;
    }

    const contactId =
      data.channelContactId?.trim() ||
      data.metaPsid?.trim() ||
      data.whatsappWaId?.trim() ||
      data.viberUserId?.trim();
    if (!contactId) continue;

    const sourceChannel = data.sourceChannel ?? "community_messenger";
    const contact = buildCommunityChannelContact({ sourceChannel, contactId });

    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const stationName = String(
      bizSnap.data()?.publicName || bizSnap.data()?.name || "Station",
    ).trim();

    return {
      contact,
      context: {
        requestId: doc.id,
        referenceId: data.referenceId?.trim() || doc.id,
        ...(data.submissionReferenceId?.trim() ?
          { trackReferenceId: data.submissionReferenceId.trim() } :
          {}),
        businessId,
        stationName,
        customerName: data.parsed?.name?.trim(),
      },
    };
  }

  const threadSnap = await db
    .collection(THREADS_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(100)
    .get();

  for (const doc of threadSnap.docs) {
    const data = doc.data() as DeliveryMessengerChatThreadDoc;
    const ref = data.referenceId?.trim().toUpperCase() ?? "";
    const track = data.trackReferenceId?.trim().toUpperCase() ?? "";
    if (ref !== token && track !== token && !ref.includes(token) && !track.includes(token)) {
      continue;
    }

    const contact = buildCommunityChannelContact({
      sourceChannel: data.sourceChannel,
      contactId: data.channelContactId,
    });

    return {
      contact,
      context: {
        requestId: data.dispatchRequestId,
        referenceId: data.referenceId,
        ...(data.trackReferenceId ? { trackReferenceId: data.trackReferenceId } : {}),
        businessId: data.businessId,
        stationName: data.stationName,
        customerName: data.customerName,
      },
    };
  }

  return null;
}

export async function listDeliveryChatsForBusiness(
  businessId: string,
  limit = 50,
): Promise<Array<DeliveryMessengerChatThreadDoc & { id: string }>> {
  const snap = await db
    .collection(THREADS_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "==", "open")
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as DeliveryMessengerChatThreadDoc),
  }));
}

export async function listDeliveryChatMessages(
  threadId: string,
  limit = 100,
): Promise<Array<DeliveryMessengerChatMessageDoc & { id: string }>> {
  const snap = await threadRef(threadId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as DeliveryMessengerChatMessageDoc),
  }));
}

export { COMMUNITY_DELIVERY_CHAT_HINT };
