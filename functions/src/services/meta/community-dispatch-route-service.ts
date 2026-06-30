import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { GeocodingService } from "../maps/geocoding-service";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import type {
  CommunityDispatchGeocode,
  CommunityDispatchRequestStatus,
} from "./community-dispatch-request-types";
import { getInitialCommunitySearchRadiusKm } from "./community-dispatch-geo-utils";
import { runCommunityDispatchSearchAtRadius } from "./community-dispatch-radius-escalation-service";
import { hasSubstantialDeliveryAddress } from "./community-dispatch-routing-engine";

export type CommunityRouteResult = {
  requestId: string;
  status: CommunityDispatchRequestStatus;
  referenceId?: string;
  replyMessage: string;
  offerIds?: string[];
};

const REQUESTS_COLLECTION = "community_dispatch_requests";

function buildNeedsLocationMessage(referenceId: string): string {
  return [
    "Thank you — we received your order. ✨",
    "",
    `Reference: ${referenceId}`,
    "",
    "We couldn't verify the delivery address from what you sent.",
    "Please reply with a clearer landmark or street address (street, barangay, city).",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/**
 * Geocode, broadcast offers at 5 km (escalates to 10 / 15 km), and reply to customer.
 */
export async function routeCommunityDispatchRequest(params: {
  requestId: string;
  fields: CommunityOrderFields;
  geocodeHint?: CommunityDispatchGeocode;
}): Promise<CommunityRouteResult> {
  const ref = db.collection(REQUESTS_COLLECTION).doc(params.requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  const existing = snap.data() as { referenceId?: string };
  const referenceId = existing.referenceId ?? params.requestId;

  await ref.set(
    {
      parsed: {
        ...(params.fields.name ? { name: params.fields.name } : {}),
        ...(params.fields.delivery !== undefined ? { delivery: params.fields.delivery } : {}),
        ...(params.fields.qty !== undefined ? { qty: params.fields.qty } : {}),
        ...(params.fields.preferredWaterType ?
          { preferredWaterType: params.fields.preferredWaterType } :
          {}),
        ...(params.fields.location ? { location: params.fields.location } : {}),
        ...(params.fields.email ? { email: params.fields.email } : {}),
        ...(params.fields.number ? { number: params.fields.number } : {}),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let geocode: CommunityDispatchGeocode | undefined = params.geocodeHint;
  if (!geocode && params.fields.delivery === true && params.fields.location?.trim()) {
    const hit = await GeocodingService.geocodeAddress(params.fields.location);
    if (hit) {
      geocode = {
        latitude: hit.latitude,
        longitude: hit.longitude,
        formattedAddress: hit.formattedAddress,
      };
    } else {
      logger.warn("routeCommunityDispatchRequest geocode_failed", {
        requestId: params.requestId,
        location: params.fields.location.trim().slice(0, 120),
        hasMapsApiKey: Boolean(GeocodingService.readApiKey()),
      });
    }
  }

  if (params.fields.delivery === true && !geocode) {
    if (!hasSubstantialDeliveryAddress(params.fields.location)) {
      await ref.set(
        {
          status: "needs_location",
          geocode: FieldValue.delete(),
          candidateBusinessIds: [],
          routingNotes: "Delivery order requires a geocodable address.",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        requestId: params.requestId,
        status: "needs_location",
        referenceId,
        replyMessage: buildNeedsLocationMessage(referenceId),
      };
    }
  }

  return runCommunityDispatchSearchAtRadius({
    requestId: params.requestId,
    referenceId,
    fields: params.fields,
    geocode,
    radiusKm: getInitialCommunitySearchRadiusKm(),
    notifyReason: "initial",
  });
}
