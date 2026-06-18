import { Request, Response } from "express";
import { answerDashboardQuestion } from "../services/ai/ai-dashboard-qa-service";
import { logger } from "../services/observability/logging/logger";

/** AI-12 — POST /business/:id/ai-tools/dashboard-qa */
export async function postDashboardQa(req: Request, res: Response) {
  const { businessId } = req.params;
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  if (!question.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  try {
    const data = await answerDashboardQuestion({ businessId, question });
    res.json({ data });
  } catch (e) {
    logger.error("postDashboardQa failed", e);
    res.status(500).json({ error: "Failed to answer question" });
  }
}
