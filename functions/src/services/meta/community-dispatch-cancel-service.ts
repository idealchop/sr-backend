import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { CommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import { closePendingOffersForRequest } from "./community-dispatch-offer-service";
import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";
import {
  buildCommunityOrderCancelledMessage,
} from "./community-messenger-customer-notifier";

const REQUESTS_COLLECTION = "community_dispatch_requests";

const CANCEL_PATTERN = new RegExp(
  "^(" +
    "cancel|cancelled|canceled|stop|withdraw|back\\s*out|" +
    "huwag\\s*na|wag\\s*na|hindi\\s*na|nevermind|never\\s*mind" +
  ")$",
  "i",
);

export function isCommunityCancelIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 32) return false;
  return CANCEL_PATTERN.test(trimmed);
}

async function findCancellableRequest(
  contact: CommunityChannelContact,
): Promise<(CommunityDispatchRequestDoc & { id: string }) | null> {
  const byChannel = await db
    .collection(REQUESTS_COLLECTION)
    .where("channelContactId", "==", contact.contactId)
    .where("status", "==", "offered")
    .limit(5)
    .get();

  const docs = byChannel.docs.length ?
    byChannel.docs :
    (await db
      .collection(REQUESTS_COLLECTION)
      .where(
        contact.sourceChannel === "community_whatsapp" ? "whatsappWaId" : "metaPsid",
        "==",
        contact.contactId,
      )
      .where("status", "==", "offered")
      .limit(5)
      .get()).docs;

  for (const doc of docs) {
    const row = { id: doc.id, ...(doc.data() as CommunityDispatchRequestDoc) };
    if (!row.smartrefillSubmissionId && !row.assignedBusinessId) {
      return row;
    }
  }

  return null;
}

export async function tryCancelActiveCommunityRequest(params: {
  contact: CommunityChannelContact;
  text: string;
}): Promise<boolean> {
  if (!isCommunityCancelIntent(params.text)) return false;

  const request = await findCancellableRequest(params.contact);
  if (!request) {
    await sendCommunityChannelText(
      params.contact,
      "We couldn't find an active order waiting for a station. If you already have a tracking link, your order may have been accepted.",
    );
    return true;
  }

  await closePendingOffersForRequest(request.id);

  await db.collection(REQUESTS_COLLECTION).doc(request.id).set(
    {
      status: "cancelled",
      routingNotes: "Cancelled by customer while waiting for station accept.",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const referenceId = request.referenceId ?? request.id;
  const result = await sendCommunityChannelText(
    params.contact,
    buildCommunityOrderCancelledMessage(referenceId),
  );

  if (!result.ok) {
    logger.warn("tryCancelActiveCommunityRequest send_failed", {
      contactId: params.contact.contactId,
      requestId: request.id,
      reason: result.reason,
    });
  }

  logger.info("tryCancelActiveCommunityRequest", {
    contactId: params.contact.contactId,
    requestId: request.id,
    referenceId,
  });

  return true;
}
