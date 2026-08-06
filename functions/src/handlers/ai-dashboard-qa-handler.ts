import { Request, Response } from "express";
import { answerDashboardQuestion } from "../services/ai/ai-dashboard-qa-service";
import {
  assertInteractiveAiQuota,
  sendAiQuotaExceeded,
} from "../services/ai/ai-tool-quota-service";
import {
  assertAiFeatureAvailable,
  sendAiUnderMaintenance,
} from "../services/ai/ai-maintenance";
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
    assertAiFeatureAvailable("dashboard.qa");
    await assertInteractiveAiQuota(businessId);
    const data = await answerDashboardQuestion({ businessId, question });
    res.json({ data });
  } catch (e) {
    if (sendAiUnderMaintenance(res, e)) return;
    if (sendAiQuotaExceeded(res, e)) return;
    logger.error("postDashboardQa failed", e);
    res.status(500).json({ error: "Failed to answer question" });
  }
}
