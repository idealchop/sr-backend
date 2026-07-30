import { isSmartrefillDevMode, resolveSmartrefillPublicBaseUrl } from "./smartrefill-env-mode";

/** Request body fields that may carry the dashboard origin for email deep links. */
export type AppBaseUrlBody = {
  appBaseUrl?: unknown;
  baseUrl?: unknown;
};

/**
 * Reads `appBaseUrl` (preferred) or legacy `baseUrl` from a POST body.
 * @param {AppBaseUrlBody} body Request JSON body.
 * @return {string|undefined} Trimmed origin when non-empty.
 */
// eslint-disable-next-line max-len
export function parseAppBaseUrlFromBody(body: AppBaseUrlBody | null | undefined): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const preferred =
    typeof body.appBaseUrl === "string" ? body.appBaseUrl.trim() : "";
  if (preferred.length > 0) return preferred;
  const legacy = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  return legacy.length > 0 ? legacy : undefined;
}

/**
 * Dashboard origin for email links: caller `appBaseUrl` wins, else env fallback.
 * @param {string} [appBaseUrl] From the active frontend (`window.location.origin`).
 * @return {string} Origin without trailing slash.
 */
export function resolveAppBaseUrlForEmail(appBaseUrl?: string | null): string {
  return resolveSmartrefillPublicBaseUrl(appBaseUrl);
}

const PRODUCTION_MARKETING_ORIGIN = "https://smartrefill.io";

/**
 * Marketing (landing) origin for guest webinar invite / join links.
 * Dev: `MARKETING_SITE_URL` or `NEXT_PUBLIC_MARKETING_SITE_URL`, else localhost:3000.
 * Prod: always https://smartrefill.io.
 */
export function resolveMarketingSiteBaseUrl(override?: string | null): string {
  const candidate = typeof override === "string" ? override.trim() : "";
  if (candidate.length > 0) {
    return candidate.replace(/\/+$/, "");
  }

  if (isSmartrefillDevMode()) {
    const fromEnv =
      process.env.MARKETING_SITE_URL?.trim() ||
      process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim();
    if (fromEnv?.length) return fromEnv.replace(/\/+$/, "");
    if (process.env.FUNCTIONS_EMULATOR) {
      return "http://localhost:3000";
    }
  }

  return PRODUCTION_MARKETING_ORIGIN;
}
