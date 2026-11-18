/**
 * Open geocoding config (River Maps stack, same as Barbers.ph): Photon first, Nominatim fallback.
 * No API keys. Both are OpenStreetMap services; Nominatim's usage policy requires an identifying
 * User-Agent, max 1 request/second, and caching — see geocoding-service.ts.
 * Optional overrides (self-hosted Photon/Nominatim later):
 * GEOCODER_PHOTON_URL, GEOCODER_NOMINATIM_URL.
 */
export const GEOCODER_USER_AGENT =
  "SmartRefill/3 (+https://smartrefill.io; support@smartrefill.io) server geocoding";

export function photonBaseUrl(): string {
  return (process.env.GEOCODER_PHOTON_URL || "https://photon.komoot.io").replace(/\/+$/, "");
}

export function nominatimBaseUrl(): string {
  return (process.env.GEOCODER_NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
}

/** Philippines bounding box (minLon,minLat,maxLon,maxLat) for Photon. */
export const PH_BBOX = "116.9,4.5,126.7,21.2";
