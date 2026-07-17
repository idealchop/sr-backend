import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { decideCommunityRouting } from "./community-dispatch-routing-engine";
import {
  closePendingOffersForRequest,
  createBroadcastCommunityDispatchOffers,
} from "./community-dispatch-offer-service";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import type {
  CommunityDispatchGeocode,
  CommunityDispatchRequestDoc,
  CommunityDispatchRequestStatus,
} from "./community-dispatch-request-types";
import { loadCommunityWrsDirectory } from "./community-dispatch-wrs-directory-service";
import {
  COMMUNITY_OFFER_RESPONSE_MINUTES,
  getInitialCommunitySearchRadiusKm,
  getNextCommunitySearchRadiusKm,
  isFinalCommunitySearchRadiusKm,
} from "./community-dispatch-geo-utils";
import {
  buildCommunityNearbyStationsAckMessage,
  buildCommunitySearchRadiusExpandMessage,
  notifyCommunityDispatchFinalized,
} from "./community-messenger-customer-notifier";
import { readCommunityCustomerContact } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import type { CommunityRouteResult } from "./community-dispatch-route-service";

const REQUESTS_COLLECTION = "community_dispatch_requests";

export type CommunitySearchNotifyReason = "initial" | "no_stations" | "no_accept";

async function loadRequest(
  requestId: string,
): Promise<(CommunityDispatchRequestDoc & { id: string }) | null> {
  const snap = await db.collection(REQUESTS_COLLECTION).doc(requestId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as CommunityDispatchRequestDoc) };
}

async function persistSearchRound(params: {
  requestId: string;
  radiusKm: number;
  candidateBusinessIds: string[];
  stationsFoundEver: boolean;
  routingNotes: string;
  offerIds: string[];
}): Promise<void> {
  await db.collection(REQUESTS_COLLECTION).doc(params.requestId).set(
    {
      status: "offered",
      routingMode: "broadcast",
      searchRadiusKm: params.radiusKm,
      stationsFoundEver: params.stationsFoundEver,
      candidateBusinessIds: params.candidateBusinessIds,
      activeOfferId: params.offerIds[0] ?? FieldValue.delete(),
      routingNotes: params.routingNotes,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function finalizeCommunityDispatchRequest(params: {
  requestId: string;
  request: CommunityDispatchRequestDoc;
  referenceId: string;
  status: CommunityDispatchRequestStatus;
  routingNotes: string;
}): Promise<CommunityRouteResult> {
  await db.collection(REQUESTS_COLLECTION).doc(params.requestId).set(
    {
      status: params.status,
      routingNotes: params.routingNotes,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const contact = readCommunityCustomerContact(params.request);
  if (contact) {
    try {
      await notifyCommunityDispatchFinalized({
        contact,
        referenceId: params.referenceId,
        stationsFoundEver: params.request.stationsFoundEver === true,
      });
    } catch (error) {
      logger.error("finalizeCommunityDispatchRequest notify_failed", error);
    }
  }

  return {
    requestId: params.requestId,
    status: params.status,
    referenceId: params.referenceId,
    replyMessage: params.request.stationsFoundEver ?
      "Finalized — stations busy." :
      "Finalized — no nearby stations.",
  };
}

/**
 * Broadcast offers at a search radius and optionally notify the customer.
 */
export async function runCommunityDispatchSearchAtRadius(params: {
  requestId: string;
  referenceId: string;
  fields: CommunityOrderFields;
  geocode?: CommunityDispatchGeocode;
  radiusKm: number;
  stationsFoundEver?: boolean;
  notifyReason?: CommunitySearchNotifyReason;
  fromRadiusKm?: number;
}): Promise<CommunityRouteResult> {
  const directory = await loadCommunityWrsDirectory();
  const decision = decideCommunityRouting({
    fields: params.fields,
    geocode: params.geocode ?
      {
        latitude: params.geocode.latitude,
        longitude: params.geocode.longitude,
        formattedAddress: params.geocode.formattedAddress,
      } :
      null,
    directory,
    searchRadiusKm: params.radiusKm,
  });

  const stationsFoundEver =
    params.stationsFoundEver === true ||
    decision.candidateBusinessIds.length > 0;

  if (
    decision.status === "no_stations" ||
    !decision.candidateBusinessIds.length
  ) {
    const nextRadius = getNextCommunitySearchRadiusKm(params.radiusKm);
    if (nextRadius && params.geocode) {
      const requestRow = await loadRequest(params.requestId);
      const contact = requestRow ? readCommunityCustomerContact(requestRow) : null;
      if (contact) {
        const expandMessage = buildCommunitySearchRadiusExpandMessage({
          referenceId: params.referenceId,
          fromRadiusKm: params.radiusKm,
          toRadiusKm: nextRadius,
          reason: "no_stations",
          nearbyCount: 0,
        });
        try {
          await sendCommunityChannelText(contact, expandMessage);
        } catch (error) {
          logger.error("runCommunityDispatchSearchAtRadius expand_notify_failed", error);
        }
      }

      return runCommunityDispatchSearchAtRadius({
        ...params,
        radiusKm: nextRadius,
        stationsFoundEver,
        fromRadiusKm: params.radiusKm,
      });
    }

    const loaded = await loadRequest(params.requestId);
    if (!loaded) {
      await db.collection(REQUESTS_COLLECTION).doc(params.requestId).set(
        {
          status: "no_stations",
          routingNotes:
            decision.routingNotes ??
            `No eligible stations within ${params.radiusKm} km.`,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        requestId: params.requestId,
        status: "no_stations",
        referenceId: params.referenceId,
        replyMessage: "Finalized — no nearby stations.",
      };
    }
    return finalizeCommunityDispatchRequest({
      requestId: params.requestId,
      request: {
        ...loaded,
        stationsFoundEver,
      },
      referenceId: params.referenceId,
      status: "no_stations",
      routingNotes:
        decision.routingNotes ??
        `No eligible stations within ${params.radiusKm} km.`,
    });
  }

  await closePendingOffersForRequest(params.requestId);

  const offerIds = await createBroadcastCommunityDispatchOffers({
    requestId: params.requestId,
    businessIds: decision.candidateBusinessIds,
  });

  await persistSearchRound({
    requestId: params.requestId,
    radiusKm: params.radiusKm,
    candidateBusinessIds: decision.candidateBusinessIds,
    stationsFoundEver,
    routingNotes: decision.routingNotes ?? "Stations notified.",
    offerIds,
  });

  let replyMessage = buildCommunityNearbyStationsAckMessage({
    referenceId: params.referenceId,
    nearbyCount: decision.candidateBusinessIds.length,
    searchRadiusKm: params.radiusKm,
    offerResponseMinutes: COMMUNITY_OFFER_RESPONSE_MINUTES,
  });

  if (
    params.notifyReason === "no_accept" &&
    params.fromRadiusKm != null
  ) {
    replyMessage = buildCommunitySearchRadiusExpandMessage({
      referenceId: params.referenceId,
      fromRadiusKm: params.fromRadiusKm,
      toRadiusKm: params.radiusKm,
      reason: "no_accept",
      nearbyCount: decision.candidateBusinessIds.length,
    });
  } else if (
    params.notifyReason === "no_stations" &&
    params.fromRadiusKm != null
  ) {
    replyMessage = buildCommunitySearchRadiusExpandMessage({
      referenceId: params.referenceId,
      fromRadiusKm: params.fromRadiusKm,
      toRadiusKm: params.radiusKm,
      reason: "no_stations",
      nearbyCount: decision.candidateBusinessIds.length,
    });
  }

  return {
    requestId: params.requestId,
    status: "offered",
    referenceId: params.referenceId,
    offerIds,
    replyMessage,
  };
}

/** After offer TTL / all declines — escalate radius or send final customer message. */
export async function finalizeOrEscalateCommunityDispatch(
  requestId: string,
): Promise<void> {
  const request = await loadRequest(requestId);
  if (!request) return;
  if (request.status !== "offered" || request.smartrefillSubmissionId) return;

  const pendingSnap = await db
    .collection("dispatch_offers")
    .where("requestId", "==", requestId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pendingSnap.empty) return;

  const acceptedSnap = await db
    .collection("dispatch_offers")
    .where("requestId", "==", requestId)
    .where("status", "==", "accepted")
    .limit(1)
    .get();
  if (!acceptedSnap.empty) return;

  const currentRadius = request.searchRadiusKm ?? getInitialCommunitySearchRadiusKm();
  const nextRadius = getNextCommunitySearchRadiusKm(currentRadius);
  const referenceId = request.referenceId ?? requestId;

  if (nextRadius && request.geocode) {
    const routed = await runCommunityDispatchSearchAtRadius({
      requestId,
      referenceId,
      fields: request.parsed ?? {},
      geocode: request.geocode,
      radiusKm: nextRadius,
      stationsFoundEver: request.stationsFoundEver === true,
      notifyReason: "no_accept",
      fromRadiusKm: currentRadius,
    });

    const customerContact = readCommunityCustomerContact(request);
    if (customerContact && routed.replyMessage) {
      await sendCommunityChannelText(customerContact, routed.replyMessage);
    }
    return;
  }

  await finalizeCommunityDispatchRequest({
    requestId,
    request,
    referenceId,
    status: isFinalCommunitySearchRadiusKm(currentRadius) ?
      "expired" :
      "no_stations",
    routingNotes: request.stationsFoundEver ?
      "No station accepted after full radius search." :
      "No eligible stations found in any search radius.",
  });
}
