import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { logger } from "../observability/logging/logger";
import { isDeployedCloudRuntime, isSmartrefillDevMode } from "../../utils/smartrefill-env-mode";

export type MetaWebhookRawBodyRequest = Request & { rawBody?: Buffer };

const SIGNATURE_HEADER = "x-hub-signature-256";

export function readMetaCommunityAppSecret(): string | undefined {
  const secret = process.env.META_COMMUNITY_APP_SECRET?.trim();
  return secret || undefined;
}

/** CP-27 — whether POST webhooks must pass HMAC signature validation. */
export function shouldEnforceMetaCommunityWebhookSignature(): boolean {
  if (readMetaCommunityAppSecret()) return true;
  if (isDeployedCloudRuntime()) return true;
  return false;
}

export function buildMetaWebhookSignature(rawBody: Buffer | string, appSecret: string): string {
  const payload = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const digest = createHmac("sha256", appSecret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function verifyMetaCommunityWebhookSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  appSecret: string;
}): boolean {
  const header = params.signatureHeader?.trim();
  if (!header?.startsWith("sha256=")) return false;

  const receivedHex = header.slice("sha256=".length);
  const expectedHex = createHmac("sha256", params.appSecret)
    .update(params.rawBody)
    .digest("hex");

  try {
    const received = Buffer.from(receivedHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

export function readMetaWebhookRawBody(req: MetaWebhookRawBodyRequest): Buffer | null {
  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody;
  }
  return null;
}

/**
 * CP-27 — validate Meta `X-Hub-Signature-256` on inbound community webhooks.
 * Returns true when the request may be processed.
 */
export function assertMetaCommunityWebhookAuthentic(req: MetaWebhookRawBodyRequest): {
  ok: true;
} | { ok: false; status: 403 | 503; reason: string } {
  const enforce = shouldEnforceMetaCommunityWebhookSignature();
  const appSecret = readMetaCommunityAppSecret();

  if (!enforce) {
    if (!isSmartrefillDevMode() && !process.env.FUNCTIONS_EMULATOR) {
      logger.warn("metaCommunityWebhook signature skipped — no app secret configured");
    }
    return { ok: true };
  }

  if (!appSecret) {
    logger.error("metaCommunityWebhook signature: META_COMMUNITY_APP_SECRET missing in production");
    return { ok: false, status: 503, reason: "webhook_not_configured" };
  }

  const rawBody = readMetaWebhookRawBody(req);
  if (!rawBody) {
    logger.warn("metaCommunityWebhook signature: raw body missing");
    return { ok: false, status: 403, reason: "missing_raw_body" };
  }

  const signatureHeader = req.get(SIGNATURE_HEADER) ?? req.get("X-Hub-Signature-256");
  const valid = verifyMetaCommunityWebhookSignature({
    rawBody,
    signatureHeader,
    appSecret,
  });

  if (!valid) {
    logger.warn("metaCommunityWebhook signature invalid", {
      hasHeader: Boolean(signatureHeader),
    });
    return { ok: false, status: 403, reason: "invalid_signature" };
  }

  return { ok: true };
}
