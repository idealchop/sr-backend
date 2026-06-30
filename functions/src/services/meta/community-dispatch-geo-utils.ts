/** Stations have this long to accept a broadcast offer (matches offer TTL). */
export const COMMUNITY_OFFER_RESPONSE_MINUTES = 3;

/** Escalating search radii for broadcast community routing (km). */
export const COMMUNITY_SEARCH_RADIUS_KM_TIERS = [5, 10, 15] as const;

export type CommunitySearchRadiusKm = (typeof COMMUNITY_SEARCH_RADIUS_KM_TIERS)[number];

/** Max radius for broadcast community routing. */
export const COMMUNITY_DISPATCH_RADIUS_KM =
  COMMUNITY_SEARCH_RADIUS_KM_TIERS[COMMUNITY_SEARCH_RADIUS_KM_TIERS.length - 1];

export function getInitialCommunitySearchRadiusKm(): CommunitySearchRadiusKm {
  return COMMUNITY_SEARCH_RADIUS_KM_TIERS[0];
}

export function getNextCommunitySearchRadiusKm(
  currentRadiusKm: number,
): CommunitySearchRadiusKm | null {
  const index = COMMUNITY_SEARCH_RADIUS_KM_TIERS.indexOf(
    currentRadiusKm as CommunitySearchRadiusKm,
  );
  if (index === -1) {
    return COMMUNITY_SEARCH_RADIUS_KM_TIERS.find((tier) => tier > currentRadiusKm) ?? null;
  }
  return COMMUNITY_SEARCH_RADIUS_KM_TIERS[index + 1] ?? null;
}

export function isFinalCommunitySearchRadiusKm(radiusKm: number): boolean {
  return radiusKm >= COMMUNITY_DISPATCH_RADIUS_KM;
}

/** Rough delivery ETA from station to customer (urban last-mile). */
export const COMMUNITY_DELIVERY_PREP_MINUTES = 15;
export const COMMUNITY_DELIVERY_MINUTES_PER_KM = 3;
export const COMMUNITY_PICKUP_PREP_MINUTES = 15;

export function formatDistanceKmForMessenger(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return "—";
  if (distanceKm < 1) {
    return `${Math.max(100, Math.round(distanceKm * 1000))} m`;
  }
  const rounded = distanceKm < 10 ? Math.round(distanceKm * 10) / 10 : Math.round(distanceKm);
  return `${rounded} km`;
}

export function estimateCommunityDeliveryEtaMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return COMMUNITY_DELIVERY_PREP_MINUTES;
  }
  const travelMinutes = Math.ceil(distanceKm * COMMUNITY_DELIVERY_MINUTES_PER_KM);
  return Math.min(180, COMMUNITY_DELIVERY_PREP_MINUTES + travelMinutes);
}

export function estimateCommunityPickupReadyMinutes(): number {
  return COMMUNITY_PICKUP_PREP_MINUTES;
}

export function formatEtaMinutesForMessenger(minutes: number): string {
  const safe = Math.max(5, Math.round(minutes));
  if (safe < 60) return `about ${safe} minutes`;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (remainder === 0) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  return `about ${hours} hr ${remainder} min`;
}


const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two WGS84 points. */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function sortByDistanceKm<T extends { lat: number; lng: number }>(
  originLat: number,
  originLng: number,
  rows: T[],
): Array<T & { distanceKm: number }> {
  return rows
    .map((row) => ({
      ...row,
      distanceKm: haversineDistanceKm(originLat, originLng, row.lat, row.lng),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function filterWithinRadiusKm<T extends { lat: number; lng: number }>(
  originLat: number,
  originLng: number,
  rows: T[],
  radiusKm: number = COMMUNITY_DISPATCH_RADIUS_KM,
): Array<T & { distanceKm: number }> {
  return sortByDistanceKm(originLat, originLng, rows).filter(
    (row) => row.distanceKm <= radiusKm,
  );
}
