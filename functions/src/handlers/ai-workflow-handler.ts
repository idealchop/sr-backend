import { Request, Response } from "express";
import { runAiWorkflow } from "../services/ai/ai-workflow-runner-service";
import { logger } from "../services/observability/logging/logger";

/** AI-49 — POST /business/:id/ai-tools/run-workflow */
export async function postRunWorkflow(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const workflowId =
    typeof req.body?.workflowId === "string" ? req.body.workflowId : undefined;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : undefined;
  try {
    const data = await runAiWorkflow({
      businessId,
      uid: user.uid,
      workflowId,
      steps,
    });
    res.status(201).json({ data });
  } catch (e) {
    logger.error("postRunWorkflow failed", e);
    res.status(500).json({ error: "Failed to run workflow" });
  }
}
