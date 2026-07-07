import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { CommunityChannelContact } from "./community-channel-contact";
import { communityContactLegacyIdField } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import { closePendingOffersForRequest } from "./community-dispatch-offer-service";
import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";
import {
  buildCommunityCancelReasonRequiredMessage,
  buildCommunityOrderCancelledMessage,
} from "./community-messenger-customer-notifier";
import { findActiveCommunityOrderForContact } from "./community-active-order-guard-service";
import { buildCommunityCancelNotAvailableAcceptedMessage } from "./community-messenger-copy";

const REQUESTS_COLLECTION = "community_dispatch_requests";

const BARE_CANCEL_PATTERN = /^cancel$/i;

const CANCEL_WITH_REASON_PATTERN = /^cancel\s*[-–—]\s*(.*)$/i;

export type CommunityCancelParseResult =
  | { kind: "with_reason"; reason: string }
  | { kind: "bare_cancel" }
  | { kind: "none" };

function normalizeCancelReason(raw: string): string | undefined {
  const reason = raw.trim().slice(0, 240);
  return reason.length >= 2 ? reason : undefined;
}

export function parseCommunityCancelRequest(text: string): CommunityCancelParseResult {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 280) return { kind: "none" };

  const withReason = trimmed.match(CANCEL_WITH_REASON_PATTERN);
  if (withReason) {
    const reason = normalizeCancelReason(withReason[1] ?? "");
    return reason ? { kind: "with_reason", reason } : { kind: "bare_cancel" };
  }

  if (BARE_CANCEL_PATTERN.test(trimmed)) {
    return { kind: "bare_cancel" };
  }

  return { kind: "none" };
}

/** @deprecated Use parseCommunityCancelRequest — bare cancel only (no reason). */
export function isCommunityCancelIntent(text: string): boolean {
  return parseCommunityCancelRequest(text).kind !== "none";
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
        communityContactLegacyIdField(contact.sourceChannel),
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
  const parsed = parseCommunityCancelRequest(params.text);
  if (parsed.kind === "none") return false;

  const request = await findCancellableRequest(params.contact);
  const referenceId = request?.referenceId ?? request?.id;
  const activeOrder = request ? null : await findActiveCommunityOrderForContact(params.contact);

  if (parsed.kind === "bare_cancel") {
    if (request) {
      await sendCommunityChannelText(
        params.contact,
        buildCommunityCancelReasonRequiredMessage(referenceId),
      );
    } else if (activeOrder?.phase === "in_delivery") {
      await sendCommunityChannelText(
        params.contact,
        buildCommunityCancelNotAvailableAcceptedMessage({
          referenceId: activeOrder.trackReferenceId ?? activeOrder.referenceId,
        }),
      );
    } else {
      await sendCommunityChannelText(
        params.contact,
        "We couldn't find an active order waiting for a station. If you already have a tracking link, your order may have been accepted.",
      );
    }
    return true;
  }

  if (!request) {
    if (activeOrder?.phase === "in_delivery") {
      await sendCommunityChannelText(
        params.contact,
        buildCommunityCancelNotAvailableAcceptedMessage({
          referenceId: activeOrder.trackReferenceId ?? activeOrder.referenceId,
        }),
      );
    } else {
      await sendCommunityChannelText(
        params.contact,
        "We couldn't find an active order waiting for a station. If you already have a tracking link, your order may have been accepted.",
      );
    }
    return true;
  }

  await closePendingOffersForRequest(request.id);

  await db.collection(REQUESTS_COLLECTION).doc(request.id).set(
    {
      status: "cancelled",
      routingNotes: `Cancelled by customer while waiting for station accept. Reason: ${parsed.reason}`,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const cancelledReferenceId = referenceId ?? request.id;
  const result = await sendCommunityChannelText(
    params.contact,
    buildCommunityOrderCancelledMessage(cancelledReferenceId),
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
    referenceId: cancelledReferenceId,
    cancelReason: parsed.reason,
  });

  return true;
}
