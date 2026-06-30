/** Browser / App Hosting key (HTTP referrer restricted). Do not use for server geocoding. */
export const GOOGLE_MAPS_SECRET_ID = "smartrefill-firebase-google-maps-api-key";

/** Server-only key (Application restrictions: None). Geocoding from Cloud Functions. */
export const GOOGLE_MAPS_SERVER_SECRET_ID = "SMARTREFILL_GOOGLE_MAPS_SERVER_API_KEY";

/** Reads Maps API key for backend (Geocoding, Routes). Prefers server secret. */
export function getGoogleMapsApiKey(): string {
  return (
    process.env[GOOGLE_MAPS_SERVER_SECRET_ID] ||
    process.env[GOOGLE_MAPS_SECRET_ID] ||
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.SMARTREFILL_GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}
