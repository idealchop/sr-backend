import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";
import {
  assertInteractiveAiQuota,
  sendAiQuotaExceeded,
} from "../services/ai/ai-tool-quota-service";
import {
  assertAiFeatureAvailable,
  sendAiUnderMaintenance,
} from "../services/ai/ai-maintenance";
import { confirmRiverAiAgentAction } from "../services/ai/river-ai-agent/river-ai-agent-confirm";
import { loadPendingAction } from "../services/ai/river-ai-agent/river-ai-agent-pending-store";
import { runRiverAiAgentTurn } from "../services/ai/river-ai-agent/river-ai-agent-service";

function getUser(req: Request) {
  return (req as { user?: { uid: string } }).user;
}

/** POST /business/:businessId/ai-tools/agent/turn */
export async function postRiverAiAgentTurn(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  try {
    assertAiFeatureAvailable("river_ai_agent.intent");
    await assertInteractiveAiQuota(businessId);
    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const businessName = String(bizSnap.data()?.businessName || bizSnap.data()?.name || "Station");
    const data = await runRiverAiAgentTurn({
      businessId,
      userId: user.uid,
      message,
      businessName,
    });
    res.json({ data });
  } catch (e) {
    if (sendAiUnderMaintenance(res, e)) return;
    if (sendAiQuotaExceeded(res, e)) return;
    logger.error("postRiverAiAgentTurn failed", e);
    res.status(500).json({ error: "Agent turn failed" });
  }
}

/** POST /business/:businessId/ai-tools/agent/confirm */
export async function postRiverAiAgentConfirm(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const actionId = typeof req.body?.actionId === "string" ? req.body.actionId : "";
  if (!actionId) {
    res.status(400).json({ error: "actionId is required" });
    return;
  }
  try {
    const pending = await loadPendingAction(businessId, actionId, user.uid);
    if (!pending) {
      res.status(404).json({ error: "Pending action not found or expired" });
      return;
    }
    const data = await confirmRiverAiAgentAction({
      businessId,
      userId: user.uid,
      pending,
    });
    res.json({ data });
  } catch (e) {
    logger.error("postRiverAiAgentConfirm failed", e);
    res.status(500).json({ error: "Agent confirm failed" });
  }
}
