import { Request, Response } from "express";
import { logger } from "../../services/observability/logging/logger";
import { processViberCommunityWebhook } from "../../services/meta/viber-community-webhook-processor";
import { assertViberCommunityWebhookAuthentic } from "../../services/meta/viber-community-webhook-auth";

/**
 * CP-31 — Viber Public Account webhook.
 * Viber expects HTTP 200 with `{ "status": 0 }` on success.
 */
export async function viberCommunityWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ status: 1, status_message: "method_not_allowed" });
    return;
  }

  const auth = await assertViberCommunityWebhookAuthentic(req);
  if (!auth.ok) {
    res
      .status(auth.status)
      .json({
        status: 1,
        status_message: auth.status === 503 ? "not_configured" : "forbidden",
      });
    return;
  }

  res.status(200).json({ status: 0 });

  void processViberCommunityWebhook(req.body).catch((error) => {
    logger.error("viberCommunityWebhook async processing failed", error);
  });
}
