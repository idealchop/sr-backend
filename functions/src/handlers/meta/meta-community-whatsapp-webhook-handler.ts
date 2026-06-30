import { Request, Response } from "express";
import { logger } from "../../services/observability/logging/logger";
import { processMetaCommunityWhatsappWebhook } from "../../services/meta/meta-community-whatsapp-webhook-processor";
import {
  assertMetaCommunityWebhookAuthentic,
  type MetaWebhookRawBodyRequest,
} from "../../services/meta/meta-community-webhook-signature";

function readVerifyToken(): string | undefined {
  const token = process.env.META_COMMUNITY_VERIFY_TOKEN?.trim();
  return token || undefined;
}

function readHubQuery(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

/**
 * CP-30 — WhatsApp Cloud API webhook (same verify token + HMAC as Messenger).
 */
export async function metaCommunityWhatsappWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method === "GET") {
    const expected = readVerifyToken();
    if (!expected) {
      logger.warn("metaCommunityWhatsappWebhook verify: META_COMMUNITY_VERIFY_TOKEN missing");
      res.status(503).send("Webhook not configured");
      return;
    }

    const mode = readHubQuery(req.query["hub.mode"]);
    const token = readHubQuery(req.query["hub.verify_token"]);
    const challenge = readHubQuery(req.query["hub.challenge"]);

    if (mode === "subscribe" && token === expected && challenge) {
      res.status(200).type("text/plain").send(challenge);
      return;
    }

    res.status(403).send("Forbidden");
    return;
  }

  if (req.method === "POST") {
    const auth = assertMetaCommunityWebhookAuthentic(req as MetaWebhookRawBodyRequest);
    if (!auth.ok) {
      res.status(auth.status).send(auth.status === 503 ? "Webhook not configured" : "Forbidden");
      return;
    }

    res.status(200).send("EVENT_RECEIVED");
    void processMetaCommunityWhatsappWebhook(req.body).catch((error) => {
      logger.error("metaCommunityWhatsappWebhook async processing failed", error);
    });
    return;
  }

  res.status(405).send("Method Not Allowed");
}
