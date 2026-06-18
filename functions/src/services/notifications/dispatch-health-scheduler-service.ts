import { AiToolRunService } from "../ai/ai-tool-run-service";
import { db } from "../../config/firebase-admin";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";

/** AI-37 — auto dispatch_health when SLA breach count > 0. */
export async function runAutoDispatchHealthForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ ran: boolean; runId?: string }> {
  const snap = await db.collection("businesses").doc(businessId).get();
  if (!snap.exists) return { ran: false };
  const uiConfig = (snap.data()?.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.slaBreachPushEnabled !== true) return { ran: false };

  const slaBreachCount = Number(uiConfig.slaBreachCount) || 0;
  if (slaBreachCount <= 0) return { ran: false };

  const ownerId = String(snap.data()?.ownerId || "");
  if (!ownerId) return { ran: false };

  const run = await AiToolRunService.executeTool({
    businessId,
    uid: ownerId,
    tool: "dispatch_health",
    scheduledAuto: true,
    scheduledDateKey: now.toISOString().slice(0, 10),
  });
  return { ran: true, runId: run.id };
}
