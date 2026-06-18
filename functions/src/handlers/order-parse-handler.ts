import { Request, Response } from "express";
import { parseFreeTextOrder } from "../services/ai/order-parse-service";
import { logger } from "../services/observability/logging/logger";

/** AI-04 — parse unstructured order text into a structured draft. */
export async function postParseOrderText(req: Request, res: Response) {
  const { businessId } = req.params;
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  if (!message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const data = await parseFreeTextOrder({ businessId, message });
    res.json({ data });
  } catch (e) {
    logger.error("postParseOrderText failed", e);
    res.status(500).json({ error: "Failed to parse order text" });
  }
}
