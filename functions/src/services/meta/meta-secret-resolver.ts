import { GoogleAuth } from "google-auth-library";
import { logger } from "../observability/logging/logger";

const PROJECT_ID =
  process.env.SMARTREFILL_FIREBASE_PROJECT_ID?.trim() || "aquaflow-management-suite";

const secretCache = new Map<string, string | null>();

/**
 * Resolve a Secret Manager value when `process.env` is empty (common for `serve:local`
 * while Meta webhooks still hit deployed Cloud Functions).
 */
export async function fetchMetaSecretFromManager(secretName: string): Promise<string | null> {
  if (secretCache.has(secretName)) {
    return secretCache.get(secretName) ?? null;
  }

  if (process.env.NODE_ENV === "test") {
    secretCache.set(secretName, null);
    return null;
  }

  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const url =
      `https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}` +
      `/secrets/${secretName}/versions/latest:access`;
    const res = await client.request<{ payload?: { data?: string } }>({ url });
    const raw = res.data.payload?.data;
    const value = raw ? Buffer.from(raw, "base64").toString("utf8").trim() : "";
    const resolved = value || null;
    secretCache.set(secretName, resolved);
    if (resolved) {
      logger.info("fetchMetaSecretFromManager resolved", { secretName });
    }
    return resolved;
  } catch (error) {
    logger.warn("fetchMetaSecretFromManager failed", { secretName, error });
    secretCache.set(secretName, null);
    return null;
  }
}
