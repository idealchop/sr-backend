import { db } from "../../config/firebase-admin";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { manilaHour } from "../../utils/philippine-datetime";

const BUSINESSES_PER_RUN = 200;

/**
 * Businesses with auto morning brief or weekly email digest enabled.
 * @param {number} [limit] Max businesses to return.
 * @return {Promise<Array<string>>} Business ids.
 */
export async function listBusinessesForMorningAlerts(
  limit = BUSINESSES_PER_RUN,
): Promise<string[]> {
  const snap = await db
    .collection("businesses")
    .where("ownerMorningAlertsEnabled", "==", true)
    .limit(limit)
    .get();

  if (!snap.empty) {
    return snap.docs.map((doc) => doc.id);
  }

  // Self-heal: businesses enabled before denormalized flag shipped.
  const fallback = await db
    .collection("businesses")
    .orderBy("updatedAt", "desc")
    .limit(limit * 2)
    .get();

  const ids: string[] = [];
  for (const doc of fallback.docs) {
    const uiConfig = (doc.data().uiConfig ?? {}) as Record<string, unknown>;
    if (resolveOwnerMorningAlertsEnabledFromUi(uiConfig)) {
      ids.push(doc.id);
      void doc.ref.set({ ownerMorningAlertsEnabled: true }, { merge: true });
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

function resolveOwnerMorningAlertsEnabledFromUi(
  uiConfig: Record<string, unknown>,
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  return (
    prefs.autoMorningBriefEnabled === true ||
    prefs.dormantEmailDigestEnabled === true ||
    prefs.morningBriefEmailEnabled === true ||
    prefs.paymentReminderEmailEnabled === true
  );
}

export function isMorningAlertHour(now = new Date()): boolean {
  const hour = manilaHour(now);
  return hour >= 5 && hour <= 10;
}
