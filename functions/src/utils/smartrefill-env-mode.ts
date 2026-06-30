/**
 * Dev vs production checkpoint for API keys, public app URLs, and config.
 *
 * - `SMARTREFILL_ENV_DEV=true` (or `1` / `yes`): use local `functions/.env` values
 *   (e.g. `SMARTREFILL_BREVO_API_KEY`, `APP_BASE_URL`).
 * - Unset / false: production — keys from Secret Manager; public links use the canonical app
   origin.
 */

const PRODUCTION_APP_ORIGIN = "https://app.smartrefill.io";

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, "");
}

// eslint-disable-next-line valid-jsdoc
/**
 * Dashboard origin for server-built deep links (invites, verification/reset emails).
 *
 * - Dev: non-empty `APP_BASE_URL` from `.env`; otherwise `https://app.smartrefill.io`
 *   (with a console warning).
 * - Prod: always `https://app.smartrefill.io` (ignores `APP_BASE_URL` in the environment).
 *
 * @param {string} [override] Optional caller value; wins when non-empty.
 */
export function resolveSmartrefillPublicBaseUrl(
  override?: string | null,
): string {
  const candidate = typeof override === "string" ? override.trim() : "";
  if (candidate.length > 0) {
    return stripTrailingSlash(candidate);
  }

  if (isSmartrefillDevMode()) {
    const fromEnv = process.env.APP_BASE_URL?.trim();
    if (fromEnv?.length) {
      return stripTrailingSlash(fromEnv);
    }
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[SmartRefill] SMARTREFILL_ENV_DEV is enabled but APP_BASE_URL is unset; " +
        "defaulting origin to https://app.smartrefill.io.",
      );
    }
    return stripTrailingSlash(PRODUCTION_APP_ORIGIN);
  }

  return stripTrailingSlash(PRODUCTION_APP_ORIGIN);
}

export function isSmartrefillDevMode(): boolean {
  const raw = process.env.SMARTREFILL_ENV_DEV;
  if (raw === undefined || raw === "") return false;
  const s = String(raw).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// eslint-disable-next-line valid-jsdoc
/** Deployed Firebase Gen2 / Cloud Run (not the Functions emulator). */
export function isDeployedCloudRuntime(): boolean {
  if (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.FUNCTIONS_EMULATOR === "1"
  ) {
    return false;
  }
  return !!(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
}

export function assertSmartrefillDevNotEnabledInProd(context: string): void {
  if (!isSmartrefillDevMode()) return;
  if (!isDeployedCloudRuntime()) return;
  throw new Error(
    `[${context}] SMARTREFILL_ENV_DEV must not be true on deployed Cloud Functions. ` +
      "Unset it in production and bind SMARTREFILL_BREVO_API_KEY from Secret Manager.",
  );
}
