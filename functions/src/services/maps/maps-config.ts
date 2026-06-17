/** Secret Manager id (same as App Hosting / legacy Firebase console). */
export const GOOGLE_MAPS_SECRET_ID = "smartrefill-firebase-google-maps-api-key";

/** Reads server Maps key from Cloud Functions secret or local `.env`.
 * @return {string} Trimmed API key, or empty when unset.
 */
export function getGoogleMapsApiKey(): string {
  return (
    process.env[GOOGLE_MAPS_SECRET_ID] ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.SMARTREFILL_GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}
