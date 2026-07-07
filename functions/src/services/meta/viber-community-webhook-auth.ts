import type { Request } from "express";
import { fetchMetaSecretFromManager } from "./meta-secret-resolver";
import { readViberCommunityAuthToken } from "./viber-community-send-service";

async function resolveExpectedAuthToken(): Promise<string | null> {
  const fromEnv = readViberCommunityAuthToken();
  if (fromEnv) return fromEnv;
  return fetchMetaSecretFromManager("VIBER_COMMUNITY_AUTH_TOKEN");
}

export type ViberWebhookAuthResult =
  | { ok: true }
  | { ok: false; status: 403 | 503 };

/**
 * CP-31 — Viber PA webhook auth via `X-Viber-Auth-Token` header.
 */
export async function assertViberCommunityWebhookAuthentic(
  req: Request,
): Promise<ViberWebhookAuthResult> {
  if (process.env.FUNCTIONS_EMULATOR || process.env.SMARTREFILL_ENV_DEV === "true") {
    return { ok: true };
  }

  const expected = await resolveExpectedAuthToken();
  if (!expected) {
    return { ok: false, status: 503 };
  }

  const header = req.header("X-Viber-Auth-Token")?.trim();
  if (!header || header !== expected) {
    return { ok: false, status: 403 };
  }

  return { ok: true };
}
