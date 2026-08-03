/**
 * Deployed Dev tier (same Firebase project, riverdb-dev).
 * Detected from Cloud Function name (`*Dev`) — do not set SMARTREFILL_ENV_DEV on these.
 */

export const DEV_IN_APP_ORIGIN =
  "https://dev-smartrefill--aquaflow-management-suite.asia-southeast1.hosted.app";

export const DEV_MARKETING_ORIGIN =
  "https://dev-smartrefill-landing--aquaflow-management-suite.asia-southeast1.hosted.app";

export const DEV_API_URL =
  "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3ApiDev";

const PROD_API_URL =
  "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api";

function cloudFunctionName(): string {
  return (
    process.env.K_SERVICE?.trim() ||
    process.env.FUNCTION_TARGET?.trim() ||
    ""
  );
}

/** True when this Cloud Run / Functions instance is a *Dev export. */
export function isSmartrefillDeployedDevTier(): boolean {
  if (
    String(process.env.SMARTREFILL_DEPLOY_TIER || "")
      .trim()
      .toLowerCase() === "dev"
  ) {
    return true;
  }
  return /Dev$/.test(cloudFunctionName());
}

/**
 * Firestore database for this instance.
 * *Dev Cloud Functions always use riverdb-dev (ignore local .env riverdb bleed-through).
 * Otherwise SMARTREFILL_FIRESTORE_DB wins, then riverdb.
 */
export function resolveFirestoreDatabaseId(): string {
  if (isSmartrefillDeployedDevTier()) {
    return "riverdb-dev";
  }
  const fromEnv = process.env.SMARTREFILL_FIRESTORE_DB?.trim();
  if (fromEnv) return fromEnv;
  return "riverdb";
}

export function resolvePublicApiBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return isSmartrefillDeployedDevTier() ? DEV_API_URL : PROD_API_URL;
}

/**
 * Dev schedulers/triggers run unless explicitly disabled.
 * Pause: set SMARTREFILL_DEV_JOBS_ENABLED=false on the Cloud Run service.
 */
export function isDevJobsEnabled(): boolean {
  const raw = process.env.SMARTREFILL_DEV_JOBS_ENABLED;
  if (raw !== undefined && raw !== "") {
    const s = String(raw).trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no") return false;
    if (s === "true" || s === "1" || s === "yes") return true;
  }
  // Default on for *Dev job/trigger instances (API-only deploy has no jobs).
  return isSmartrefillDeployedDevTier();
}
