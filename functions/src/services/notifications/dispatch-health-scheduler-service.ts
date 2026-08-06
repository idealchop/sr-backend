import { AiToolRunService } from "../ai/ai-tool-run-service";
import { tryConsumeAutoAiToolSlot } from "../ai/auto-ai-tool-budget";
import { SMARTREFILL_AI_UNDER_MAINTENANCE } from "../ai/ai-maintenance";
import { db, FieldValue } from "../../config/firebase-admin";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import { manilaDateKey } from "../../utils/philippine-datetime";

/** AI-37 — auto dispatch_health when SLA breach count > 0 (once per Manila day). */
export async function runAutoDispatchHealthForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ ran: boolean; runId?: string }> {
  if (SMARTREFILL_AI_UNDER_MAINTENANCE) return { ran: false };

  const businessRef = db.collection("businesses").doc(businessId);
  const snap = await businessRef.get();
  if (!snap.exists) return { ran: false };
  const data = snap.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.slaBreachPushEnabled !== true) return { ran: false };

  const slaBreachCount = Number(uiConfig.slaBreachCount) || 0;
  if (slaBreachCount <= 0) return { ran: false };

  const dateKey = manilaDateKey(now);
  const lastRunDate =
    typeof data.dispatchHealthLastAutoRunDate === "string" ?
      data.dispatchHealthLastAutoRunDate :
      undefined;
  if (lastRunDate === dateKey) return { ran: false };

  const ownerId = String(data.ownerId || "");
  if (!ownerId) return { ran: false };

  if (!(await tryConsumeAutoAiToolSlot(businessId, dateKey))) {
    return { ran: false };
  }

  const run = await AiToolRunService.executeTool({
    businessId,
    uid: ownerId,
    tool: "dispatch_health",
    scheduledAuto: true,
    scheduledDateKey: dateKey,
  });

  await businessRef.set(
    {
      dispatchHealthLastAutoRunDate: dateKey,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ran: true, runId: run.id };
}
