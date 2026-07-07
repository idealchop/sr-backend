import { db } from "../../config/firebase-admin";
import type { CommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import type {
  CommunityDispatchRequestDoc,
  CommunityDispatchRequestStatus,
} from "./community-dispatch-request-types";
import { buildCommunityActiveOrderBlockedMessage } from "./community-messenger-copy";
import type { CommunityMessengerSession } from "./community-messenger-session-service";

const REQUESTS_COLLECTION = "community_dispatch_requests";

const TERMINAL_DISPATCH_STATUSES = new Set<CommunityDispatchRequestStatus>([
  "expired",
  "cancelled",
  "no_stations",
]);

const TERMINAL_DELIVERY_STATUSES = new Set([
  "delivered",
  "collected",
  "completed",
  "cancelled",
  "failed",
]);

export type CommunityActiveOrderPhase =
  import("./community-messenger-copy").CommunityActiveOrderBlockedPhase;

export type CommunityActiveOrderSnapshot = {
  requestId: string;
  referenceId: string;
  dispatchStatus: CommunityDispatchRequestStatus;
  phase: CommunityActiveOrderPhase;
  /** Station transaction reference when accepted. */
  trackReferenceId?: string;
};

export type AcceptedDeliveryChatContext = {
  requestId: string;
  referenceId: string;
  trackReferenceId?: string;
  businessId: string;
  stationName: string;
  customerName?: string;
};

function readTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const maybe = value as { toMillis?: () => number };
  return typeof maybe.toMillis === "function" ? maybe.toMillis() : 0;
}

async function queryDispatchRequestsForContact(
  contact: CommunityChannelContact,
): Promise<Array<{ id: string; doc: CommunityDispatchRequestDoc }>> {
  let snap = await db
    .collection(REQUESTS_COLLECTION)
    .where("channelContactId", "==", contact.contactId)
    .limit(25)
    .get();

  if (snap.empty) {
    snap = await db
      .collection(REQUESTS_COLLECTION)
      .where(
        contact.sourceChannel === "community_whatsapp" ? "whatsappWaId" : "metaPsid",
        "==",
        contact.contactId,
      )
      .limit(25)
      .get();
  }

  return snap.docs
    .map((doc) => ({
      id: doc.id,
      doc: doc.data() as CommunityDispatchRequestDoc,
    }))
    .sort((a, b) => readTimestampMs(b.doc.updatedAt) - readTimestampMs(a.doc.updatedAt));
}

async function isAcceptedDeliveryStillOpen(
  request: CommunityDispatchRequestDoc,
): Promise<boolean> {
  const businessId = request.assignedBusinessId?.trim();
  const referenceId =
    request.submissionReferenceId?.trim() || request.referenceId?.trim();
  if (!businessId || !referenceId) return true;

  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("referenceId", "==", referenceId)
    .limit(1)
    .get();

  if (snap.empty) return true;

  const status = String(snap.docs[0].data()?.deliveryStatus ?? "pending").toLowerCase();
  return !TERMINAL_DELIVERY_STATUSES.has(status);
}

function resolveActiveOrderPhase(
  status: CommunityDispatchRequestStatus,
): CommunityActiveOrderPhase {
  if (status === "needs_location") return "needs_address";
  if (status === "accepted") return "in_delivery";
  return "waiting_station";
}

/** Latest non-terminal community order for this customer — blocks new delivery orders. */
export async function findActiveCommunityOrderForContact(
  contact: CommunityChannelContact,
): Promise<CommunityActiveOrderSnapshot | null> {
  const rows = await queryDispatchRequestsForContact(contact);

  for (const row of rows) {
    const status = row.doc.status;
    if (TERMINAL_DISPATCH_STATUSES.has(status)) continue;

    if (status === "accepted") {
      const stillOpen = await isAcceptedDeliveryStillOpen(row.doc);
      if (!stillOpen) continue;
    }

    const referenceId = row.doc.referenceId?.trim() || row.id;
    return {
      requestId: row.id,
      referenceId,
      dispatchStatus: status,
      phase: resolveActiveOrderPhase(status),
      ...(row.doc.submissionReferenceId?.trim() ?
        { trackReferenceId: row.doc.submissionReferenceId.trim() } :
        {}),
    };
  }

  return null;
}

/** Accepted order still in delivery — eligible for station↔customer chat. */
export async function findAcceptedDeliveryChatContext(
  contact: CommunityChannelContact,
): Promise<AcceptedDeliveryChatContext | null> {
  const active = await findActiveCommunityOrderForContact(contact);
  if (!active || active.phase !== "in_delivery") return null;

  const rowSnap = await db.collection(REQUESTS_COLLECTION).doc(active.requestId).get();
  if (!rowSnap.exists) return null;

  const row = rowSnap.data() as CommunityDispatchRequestDoc;
  const businessId = row.assignedBusinessId?.trim();
  if (!businessId) return null;

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const stationName = String(
    bizSnap.data()?.publicName || bizSnap.data()?.name || "Station",
  ).trim();

  return {
    requestId: active.requestId,
    referenceId: active.referenceId,
    ...(active.trackReferenceId ? { trackReferenceId: active.trackReferenceId } : {}),
    businessId,
    stationName,
    ...(row.parsed?.name?.trim() ? { customerName: row.parsed.name.trim() } : {}),
  };
}

/** Session follow-up for the same draft — not a new order attempt. */
export function isContinuingCommunityOrderSession(
  session: CommunityMessengerSession | null | undefined,
): boolean {
  if (!session) return false;
  return Boolean(
    session.missingFields?.length ||
    session.repairAwait ||
    session.awaitingConfirmation ||
    (session.wizardStep && session.wizardStep !== "confirm"),
  );
}

export async function sendCommunityActiveOrderBlockedReply(
  contact: CommunityChannelContact,
  active: CommunityActiveOrderSnapshot,
): Promise<void> {
  const message = buildCommunityActiveOrderBlockedMessage({
    referenceId: active.trackReferenceId ?? active.referenceId,
    phase: active.phase,
  });
  await sendCommunityChannelText(contact, message);
}

/** Block starting a brand-new delivery order while one is still open. */
export async function blockIfActiveCommunityOrder(params: {
  contact: CommunityChannelContact;
  session?: CommunityMessengerSession | null;
  allowNeedsAddressRetry?: boolean;
}): Promise<CommunityActiveOrderSnapshot | null> {
  if (isContinuingCommunityOrderSession(params.session)) {
    return null;
  }

  const active = await findActiveCommunityOrderForContact(params.contact);
  if (!active) return null;

  if (
    params.allowNeedsAddressRetry &&
    active.phase === "needs_address"
  ) {
    return null;
  }

  await sendCommunityActiveOrderBlockedReply(params.contact, active);
  return active;
}
