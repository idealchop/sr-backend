import { Request, Response } from "express";
import { AiToolRunService } from "../services/ai/ai-tool-run-service";
import { AiToolQuotaExceededError } from "../services/ai/ai-tool-quota-service";
import { sendAiUnderMaintenance } from "../services/ai/ai-maintenance";
import { logger } from "../services/observability/logging/logger";

export async function listAiToolRuns(req: Request, res: Response) {
  const { businessId } = req.params;

  try {
    const limit = Math.min(
      60,
      Math.max(1, parseInt(String(req.query.limit || "40"), 10) || 40),
    );
    const data = await AiToolRunService.listRuns(businessId, limit);
    res.json({ data });
  } catch (e) {
    logger.error("listAiToolRuns failed", e);
    res.status(500).json({ error: "Failed to list AI tool runs" });
  }
}

export async function createAiToolRun(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tool = typeof req.body?.tool === "string" ? req.body.tool : "";
  if (!tool) {
    res.status(400).json({ error: "tool is required" });
    return;
  }

  try {
    const run = await AiToolRunService.executeTool({
      businessId,
      uid: user.uid,
      tool,
    });
    res.status(201).json({ data: run });
  } catch (e: unknown) {
    if (sendAiUnderMaintenance(res, e)) return;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_TOOL") {
      res.status(400).json({ error: "Unknown tool id" });
      return;
    }
    if (e instanceof AiToolQuotaExceededError) {
      res.status(429).json({
        error: "AI tool monthly quota exceeded",
        code: e.code,
        used: e.used,
        max: e.max,
      });
      return;
    }
    logger.error("createAiToolRun failed", e);
    res.status(500).json({ error: "Failed to run AI tool" });
  }
}
