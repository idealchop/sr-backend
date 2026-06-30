import type { GeocodeResult } from "../maps/geocoding-service";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import { sortByDistanceKm, filterWithinRadiusKm } from "./community-dispatch-geo-utils";
import type { CommunityWrsDirectoryEntry } from "./community-dispatch-request-types";

export type CommunityRoutingDecision = {
  status: "offered" | "needs_location" | "no_stations";
  geocode?: GeocodeResult;
  candidateBusinessIds: string[];
  routingNotes?: string;
};

function rankCandidates(
  directory: CommunityWrsDirectoryEntry[],
  geocode: GeocodeResult | null,
): CommunityWrsDirectoryEntry[] {
  if (!geocode) return [...directory];
  return sortByDistanceKm(geocode.latitude, geocode.longitude, directory);
}

/** Delivery can proceed on text address when geocoding is unavailable (missing API key, etc.). */
export function hasSubstantialDeliveryAddress(location: string | undefined): boolean {
  const trimmed = location?.trim() ?? "";
  if (trimmed.length < 12) return false;
  if (trimmed.includes(",")) return true;
  return trimmed.split(/\s+/).filter(Boolean).length >= 4;
}

/** Broadcast eligible WRS within a search radius — first station to accept wins. */
export function decideCommunityRouting(params: {
  fields: CommunityOrderFields;
  geocode: GeocodeResult | null;
  directory: CommunityWrsDirectoryEntry[];
  searchRadiusKm?: number;
}): CommunityRoutingDecision {
  const { fields, geocode, directory } = params;
  const searchRadiusKm = params.searchRadiusKm ?? 5;

  if (!directory.length) {
    return {
      status: "no_stations",
      candidateBusinessIds: [],
      routingNotes: "No eligible stations are accepting community orders.",
    };
  }

  const substantialAddress = hasSubstantialDeliveryAddress(fields.location);

  if (fields.delivery === true && !geocode && !substantialAddress) {
    return {
      status: "needs_location",
      candidateBusinessIds: [],
      routingNotes: "Delivery order requires a geocodable address.",
    };
  }

  const nearbyDirectory =
    geocode ?
      filterWithinRadiusKm(
        geocode.latitude,
        geocode.longitude,
        directory,
        searchRadiusKm,
      ) :
      directory;

  if (geocode && !nearbyDirectory.length) {
    return {
      status: "no_stations",
      candidateBusinessIds: [],
      routingNotes: `No eligible stations within ${searchRadiusKm} km of your location.`,
    };
  }

  const ranked = rankCandidates(
    nearbyDirectory.length ? nearbyDirectory : directory,
    geocode,
  );
  const candidateBusinessIds = ranked.map((row) => row.businessId);

  if (!candidateBusinessIds.length) {
    return {
      status: "no_stations",
      candidateBusinessIds: [],
      routingNotes: "No routable station found.",
    };
  }

  const notes =
    !geocode && substantialAddress ?
      "Address saved — nearby stations notified (map pin not verified). First to accept will confirm your order." :
      "Nearby stations notified — first to accept will confirm your order.";

  return {
    status: "offered",
    geocode: geocode ?? undefined,
    candidateBusinessIds,
    routingNotes: notes,
  };
}
