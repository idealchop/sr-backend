import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { createCommunityDispatchSubmission } from "./community-dispatch-handoff-service";
import {
  notifyCommunityOrderAccepted,
  resolveCommunityOrderAcceptedMetrics,
} from "./community-messenger-customer-notifier";
import { finalizeOrEscalateCommunityDispatch } from "./community-dispatch-radius-escalation-service";
import { incrementCommunityOrdersAccepted } from "./community-dispatch-station-usage-service";
import { sendCommunityDispatchOfferPush } from "../notifications/community-dispatch-offer-push-service";
import type {
  CommunityDispatchOfferDoc,
  CommunityDispatchRequestDoc,
} from "./community-dispatch-request-types";
import { COMMUNITY_OFFER_RESPONSE_MINUTES } from "./community-dispatch-geo-utils";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";

const OFFERS_COLLECTION = "dispatch_offers";
const REQUESTS_COLLECTION = "community_dispatch_requests";
export const OFFER_TTL_MS = COMMUNITY_OFFER_RESPONSE_MINUTES * 60 * 1000;

export function buildOfferDocId(requestId: string, businessId: string): string {
  return `${requestId}__${businessId}`;
}

function readTimestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { toMillis?: () => number };
  return typeof maybe.toMillis === "function" ? maybe.toMillis() : null;
}

export function isOfferExpired(offer: CommunityDispatchOfferDoc): boolean {
  if (offer.status !== "pending") return false;
  const expiresAtMs = readTimestampMillis(offer.expiresAt);
  return expiresAtMs != null && expiresAtMs <= Date.now();
}

async function resolveStationPublicName(businessId: string): Promise<string> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const name = snap.data()?.communityDispatch?.publicName ?? snap.data()?.name;
  return typeof name === "string" && name.trim() ? name.trim() : "Your refilling station";
}

async function resolveStationCoords(
  businessId: string,
): Promise<{ lat: number; lng: number } | null> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const location = snap.data()?.location as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

async function runCommunityDispatchOfferSideEffects(params: {
  requestId: string;
  businessId: string;
  offerId: string;
  rank: number;
  created: boolean;
}): Promise<void> {
  if (!params.created) return;

  const request = await loadRequest(params.requestId);
  if (!request) return;

  await sendCommunityDispatchOfferPush({
    businessId: params.businessId,
    requestId: params.requestId,
    request,
    offerId: params.offerId,
    rank: params.rank,
  });
}

export async function createCommunityDispatchOffer(params: {
  requestId: string;
  businessId: string;
  rank?: number;
}): Promise<{ offerId: string; created: boolean }> {
  const offerId = buildOfferDocId(params.requestId, params.businessId);
  const ref = db.collection(OFFERS_COLLECTION).doc(offerId);
  const expiresAt = Timestamp.fromMillis(Date.now() + OFFER_TTL_MS);
  const rank = params.rank ?? 0;

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const prior = existing.data() as CommunityDispatchOfferDoc;
      if (prior.status === "pending") {
        return { offerId, created: false };
      }
      if (prior.status === "declined" || prior.status === "accepted") {
        return { offerId, created: false };
      }
    }

    const doc: CommunityDispatchOfferDoc = {
      requestId: params.requestId,
      businessId: params.businessId,
      status: "pending",
      rank,
      expiresAt,
      createdAt: existing.exists ?
        (existing.data() as CommunityDispatchOfferDoc).createdAt :
        FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(ref, doc, { merge: false });
    return { offerId, created: true };
  });

  if (result.created) {
    try {
      await runCommunityDispatchOfferSideEffects({
        requestId: params.requestId,
        businessId: params.businessId,
        offerId: result.offerId,
        rank,
        created: true,
      });
    } catch (error) {
      logger.error("runCommunityDispatchOfferSideEffects failed", error);
    }
  }

  return result;
}

/** Broadcast — create pending offers for every nearby WRS (skips declined). */
export async function createBroadcastCommunityDispatchOffers(params: {
  requestId: string;
  businessIds: string[];
}): Promise<string[]> {
  const declinedSnap = await db
    .collection(OFFERS_COLLECTION)
    .where("requestId", "==", params.requestId)
    .where("status", "==", "declined")
    .get();
  const declinedIds = new Set(
    declinedSnap.docs.map((doc) => (doc.data() as CommunityDispatchOfferDoc).businessId),
  );

  const offerIds: string[] = [];

  for (let rank = 0; rank < params.businessIds.length; rank++) {
    const businessId = params.businessIds[rank];
    if (declinedIds.has(businessId)) continue;
    if (!(await isBusinessEligibleForCommunityMessenger(businessId))) continue;
    const result = await createCommunityDispatchOffer({
      requestId: params.requestId,
      businessId,
      rank,
    });
    if (result.created) {
      offerIds.push(result.offerId);
    }
  }

  logger.info("createBroadcastCommunityDispatchOffers", {
    requestId: params.requestId,
    offerCount: offerIds.length,
    stationCount: params.businessIds.length,
  });

  return offerIds;
}

export async function getCommunityDispatchOffer(
  offerId: string,
): Promise<(CommunityDispatchOfferDoc & { id: string }) | null> {
  const snap = await db.collection(OFFERS_COLLECTION).doc(offerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as CommunityDispatchOfferDoc) };
}

export async function getPendingCommunityDispatchOfferForBusiness(
  businessId: string,
): Promise<(CommunityDispatchOfferDoc & { id: string }) | null> {
  if (!(await isBusinessEligibleForCommunityMessenger(businessId))) {
    return null;
  }

  const snap = await db
    .collection(OFFERS_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "==", "pending")
    .limit(5)
    .get();

  for (const doc of snap.docs) {
    const offer = { id: doc.id, ...(doc.data() as CommunityDispatchOfferDoc) };
    if (!isOfferExpired(offer)) {
      return offer;
    }
  }

  return null;
}

async function loadRequest(requestId: string): Promise<CommunityDispatchRequestDoc | null> {
  const snap = await db.collection(REQUESTS_COLLECTION).doc(requestId).get();
  if (!snap.exists) return null;
  return snap.data() as CommunityDispatchRequestDoc;
}

async function recordCustomerMessengerNotify(
  requestId: string,
  result: { ok: boolean; reason?: string; context: string },
): Promise<void> {
  await db.collection(REQUESTS_COLLECTION).doc(requestId).set(
    {
      lastCustomerMessengerNotifyAt: FieldValue.serverTimestamp(),
      lastCustomerMessengerNotifyOk: result.ok,
      lastCustomerMessengerNotifyContext: result.context,
      ...(result.ok ?
        { lastCustomerMessengerNotifyError: FieldValue.delete() } :
        { lastCustomerMessengerNotifyError: result.reason ?? "unknown" }),
    },
    { merge: true },
  );
}

async function markOfferStatus(
  offerId: string,
  status: CommunityDispatchOfferDoc["status"],
): Promise<void> {
  await db.collection(OFFERS_COLLECTION).doc(offerId).set(
    {
      status,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Close pending offers before a new search radius round. */
export async function closePendingOffersForRequest(requestId: string): Promise<void> {
  const snap = await db
    .collection(OFFERS_COLLECTION)
    .where("requestId", "==", requestId)
    .where("status", "==", "pending")
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.set(
      doc.ref,
      { status: "expired", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
}

async function supersedeOtherPendingOffers(
  requestId: string,
  winningOfferId: string,
): Promise<void> {
  const snap = await db
    .collection(OFFERS_COLLECTION)
    .where("requestId", "==", requestId)
    .where("status", "==", "pending")
    .get();

  const batch = db.batch();
  for (const doc of snap.docs) {
    if (doc.id === winningOfferId) continue;
    batch.set(
      doc.ref,
      { status: "superseded", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
}

async function maybeMarkRequestExhausted(requestId: string): Promise<void> {
  await finalizeOrEscalateCommunityDispatch(requestId);
}

/** Expire pending offers; notify customer when all stations pass without accepting. */
export async function expireStaleCommunityDispatchOffers(limit = 25): Promise<{
  expiredCount: number;
  exhaustedCount: number;
}> {
  const snap = await db
    .collection(OFFERS_COLLECTION)
    .where("status", "==", "pending")
    .limit(limit)
    .get();

  let expiredCount = 0;
  let exhaustedCount = 0;
  const touchedRequestIds = new Set<string>();

  for (const doc of snap.docs) {
    const offer = doc.data() as CommunityDispatchOfferDoc;
    if (!isOfferExpired(offer)) continue;

    await markOfferStatus(doc.id, "expired");
    expiredCount += 1;
    touchedRequestIds.add(offer.requestId);
  }

  for (const requestId of touchedRequestIds) {
    const before = await loadRequest(requestId);
    await maybeMarkRequestExhausted(requestId);
    const after = await loadRequest(requestId);
    if (before?.status === "offered" && after?.status === "expired") {
      exhaustedCount += 1;
    }
  }

  return { expiredCount, exhaustedCount };
}

export type AcceptCommunityDispatchOfferResult =
  | {
    ok: true;
    submissionId: string;
    submissionReferenceId: string;
    customerMessengerNotified: boolean;
    customerMessengerNotifyError?: string;
  }
  | {
    ok: false;
    code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "EXPIRED"
      | "ALREADY_ACCEPTED"
      | "REQUEST_CLOSED"
      | "PLAN_NOT_ELIGIBLE";
  };

/** First WRS to accept wins — creates submission and notifies customer immediately. */
export async function acceptCommunityDispatchOffer(params: {
  offerId: string;
  businessId: string;
  acceptedByUid: string;
}): Promise<AcceptCommunityDispatchOfferResult> {
  if (!(await isBusinessEligibleForCommunityMessenger(params.businessId))) {
    return { ok: false, code: "PLAN_NOT_ELIGIBLE" };
  }

  const offer = await getCommunityDispatchOffer(params.offerId);
  if (!offer) return { ok: false, code: "NOT_FOUND" };
  if (offer.businessId !== params.businessId) return { ok: false, code: "FORBIDDEN" };

  const requestRef = db.collection(REQUESTS_COLLECTION).doc(offer.requestId);
  const offerRef = db.collection(OFFERS_COLLECTION).doc(params.offerId);

  if (offer.status !== "pending") {
    const request = await loadRequest(offer.requestId);
    if (request?.status === "accepted" || request?.smartrefillSubmissionId) {
      return { ok: false, code: "ALREADY_ACCEPTED" };
    }
    return { ok: false, code: "ALREADY_ACCEPTED" };
  }

  if (isOfferExpired(offer)) {
    await markOfferStatus(params.offerId, "expired");
    await maybeMarkRequestExhausted(offer.requestId);
    return { ok: false, code: "EXPIRED" };
  }

  const claimResult = await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    const offerSnap = await tx.get(offerRef);

    if (!requestSnap.exists || !offerSnap.exists) {
      return { claimed: false as const, code: "NOT_FOUND" as const };
    }

    const request = requestSnap.data() as CommunityDispatchRequestDoc;
    const liveOffer = offerSnap.data() as CommunityDispatchOfferDoc;

    if (request.status !== "offered" || request.smartrefillSubmissionId) {
      return { claimed: false as const, code: "ALREADY_ACCEPTED" as const };
    }

    if (liveOffer.status !== "pending") {
      return { claimed: false as const, code: "ALREADY_ACCEPTED" as const };
    }

    const expiresAtMs = readTimestampMillis(liveOffer.expiresAt);
    if (expiresAtMs != null && expiresAtMs <= Date.now()) {
      return { claimed: false as const, code: "EXPIRED" as const };
    }

    tx.set(
      offerRef,
      {
        status: "accepted",
        acceptedByUid: params.acceptedByUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      requestRef,
      {
        status: "accepted",
        assignedBusinessId: params.businessId,
        activeOfferId: params.offerId,
        routingNotes: "Accepted by station — creating submission.",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { claimed: true as const, request };
  });

  if (!claimResult.claimed) {
    if (claimResult.code === "EXPIRED") {
      await markOfferStatus(params.offerId, "expired");
      await maybeMarkRequestExhausted(offer.requestId);
    }
    return { ok: false, code: claimResult.code };
  }

  const request = claimResult.request;
  const stationName = await resolveStationPublicName(params.businessId);
  const customerPsid = request.metaPsid?.trim() ?? "";
  const stationCoords = await resolveStationCoords(params.businessId);
  const acceptedMetrics =
    stationCoords ?
      resolveCommunityOrderAcceptedMetrics({
        request,
        stationLat: stationCoords.lat,
        stationLng: stationCoords.lng,
      }) :
      null;

  const handoff = await createCommunityDispatchSubmission({
    businessId: params.businessId,
    requestId: offer.requestId,
    request,
    acceptedByUid: params.acceptedByUid,
  });

  await supersedeOtherPendingOffers(offer.requestId, params.offerId);

  await requestRef.set(
    {
      smartrefillSubmissionId: handoff.submissionId,
      submissionReferenceId: handoff.submissionReferenceId,
      routingNotes: `Accepted by station — submission ${handoff.submissionReferenceId}.`,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const notifyResult = await notifyCommunityOrderAccepted({
    psid: customerPsid,
    businessId: params.businessId,
    stationName,
    referenceId: handoff.submissionReferenceId,
    request,
    distanceKm: acceptedMetrics?.distanceKm,
    etaMinutes: acceptedMetrics?.etaMinutes,
  });

  await recordCustomerMessengerNotify(offer.requestId, {
    ok: notifyResult.ok,
    reason: notifyResult.ok ? undefined : notifyResult.reason,
    context: "broadcast_accept",
  });

  try {
    await incrementCommunityOrdersAccepted(params.businessId);
  } catch (error) {
    logger.error("incrementCommunityOrdersAccepted failed", error);
  }

  if (!customerPsid) {
    logger.error("acceptCommunityDispatchOffer missing_customer_psid", {
      offerId: params.offerId,
      requestId: offer.requestId,
      referenceId: request.referenceId,
    });
  } else if (!notifyResult.ok) {
    logger.error("acceptCommunityDispatchOffer customer_notify_failed", {
      offerId: params.offerId,
      requestId: offer.requestId,
      referenceId: request.referenceId,
      reason: notifyResult.reason,
    });
  }

  logger.info("acceptCommunityDispatchOffer", {
    offerId: params.offerId,
    requestId: offer.requestId,
    businessId: params.businessId,
    submissionId: handoff.submissionId,
    customerMessengerNotified: notifyResult.ok,
  });

  return {
    ok: true,
    submissionId: handoff.submissionId,
    submissionReferenceId: handoff.submissionReferenceId,
    customerMessengerNotified: notifyResult.ok,
    ...(notifyResult.ok ? {} : { customerMessengerNotifyError: notifyResult.reason }),
  };
}

export async function declineCommunityDispatchOffer(params: {
  offerId: string;
  businessId: string;
  declineReason?: string;
}): Promise<{ ok: boolean; code?: "NOT_FOUND" | "FORBIDDEN" | "ALREADY_ACCEPTED" }> {
  const offer = await getCommunityDispatchOffer(params.offerId);
  if (!offer) return { ok: false, code: "NOT_FOUND" };
  if (offer.businessId !== params.businessId) return { ok: false, code: "FORBIDDEN" };
  if (offer.status !== "pending") {
    const request = await loadRequest(offer.requestId);
    if (request?.status === "accepted" || request?.smartrefillSubmissionId) {
      return { ok: false, code: "ALREADY_ACCEPTED" };
    }
    return { ok: false, code: "ALREADY_ACCEPTED" };
  }

  const declineReason = params.declineReason?.trim().slice(0, 500) || "No reason provided";

  await db.collection(OFFERS_COLLECTION).doc(params.offerId).set(
    {
      status: "declined",
      declineReason,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await maybeMarkRequestExhausted(offer.requestId);

  logger.info("declineCommunityDispatchOffer", {
    offerId: params.offerId,
    requestId: offer.requestId,
    businessId: params.businessId,
    declineReason,
  });

  return { ok: true };
}
