import { Request, Response } from "express";
import { logger } from "../../services/observability/logging/logger";
import { processMetaCommunityWebhook } from "../../services/meta/meta-community-webhook-processor";
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
 * Meta Messenger webhook for the River community Page (CP-01 / CP-02).
 * GET: verify handshake (hub.challenge echo).
 * POST: ack fast, then auto-reply with order template (CP-02).
 */
export async function metaCommunityWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method === "GET") {
    const expected = readVerifyToken();
    if (!expected) {
      logger.warn("metaCommunityWebhook verify: META_COMMUNITY_VERIFY_TOKEN missing");
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

    logger.warn("metaCommunityWebhook verify failed", { mode, tokenMatch: token === expected });
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
    void processMetaCommunityWebhook(req.body).catch((error) => {
      logger.error("metaCommunityWebhook async processing failed", error);
    });
    return;
  }

  res.status(405).send("Method Not Allowed");
}
