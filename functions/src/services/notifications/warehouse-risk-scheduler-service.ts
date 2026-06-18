import { AiToolRunService } from "../ai/ai-tool-run-service";
import { db } from "../../config/firebase-admin";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";

/** AI-38 — auto warehouse_risk when reorder insight fires. */
export async function runAutoWarehouseRiskForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ ran: boolean; runId?: string }> {
  const snap = await db.collection("businesses").doc(businessId).get();
  if (!snap.exists) return { ran: false };
  const uiConfig = (snap.data()?.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.reorderPushEnabled !== true) return { ran: false };

  const reorderTriggered = uiConfig.reorderInsightActive === true;
  if (!reorderTriggered) return { ran: false };

  const ownerId = String(snap.data()?.ownerId || "");
  if (!ownerId) return { ran: false };

  const run = await AiToolRunService.executeTool({
    businessId,
    uid: ownerId,
    tool: "warehouse_risk",
    scheduledAuto: true,
    scheduledDateKey: now.toISOString().slice(0, 10),
  });
  return { ran: true, runId: run.id };
}
