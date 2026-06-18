import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { AiToolRunService } from "../ai/ai-tool-run-service";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";

export function shouldRunAutoMorningBriefNow(
  uiConfig: Record<string, unknown> | undefined,
  lastRunDate: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (
    prefs.autoMorningBriefEnabled !== true &&
    prefs.morningBriefEmailEnabled !== true
  ) {
    return false;
  }
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastRunDate;
}

/**
 * BL-07 — runs one scheduled `morning_brief` per business per Manila calendar day.
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<{ran: boolean, runId: (string|undefined)}>} Run outcome.
 */
export async function runAutoMorningBriefForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ ran: boolean; runId?: string }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { ran: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastRunDate =
    typeof data.morningBriefLastAutoRunDate === "string" ?
      data.morningBriefLastAutoRunDate :
      undefined;

  if (!shouldRunAutoMorningBriefNow(uiConfig, lastRunDate, now)) {
    return { ran: false };
  }

  const ownerId = String(data.ownerId || "").trim();
  if (!ownerId) {
    logger.warn("autoMorningBrief skipped — missing ownerId", { businessId });
    return { ran: false };
  }

  const dateKey = manilaDateKey(now);
  const run = await AiToolRunService.executeTool({
    businessId,
    uid: ownerId,
    tool: "morning_brief",
    scheduledAuto: true,
    scheduledDateKey: dateKey,
  });

  await businessRef.set(
    {
      morningBriefLastAutoRunDate: dateKey,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ran: true, runId: run.id };
}
