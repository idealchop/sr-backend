import { db } from "../../config/firebase-admin";
import { resolveOwnerMorningAlertsEnabled } from "../../utils/notification-preferences";
import { isBusinessEligibleForStationAlerts } from "../../utils/scale-plan-access";
import { manilaHour } from "../../utils/philippine-datetime";

const BUSINESSES_PER_RUN = 200;

/**
 * Scale businesses with owner email alerts enabled.
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
    const ids: string[] = [];
    for (const doc of snap.docs) {
      if (await isBusinessEligibleForStationAlerts(doc.id)) {
        ids.push(doc.id);
      } else {
        void doc.ref.set({ ownerMorningAlertsEnabled: false }, { merge: true });
      }
    }
    return ids;
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
    if (resolveOwnerMorningAlertsEnabled(uiConfig) &&
      (await isBusinessEligibleForStationAlerts(doc.id))) {
      ids.push(doc.id);
      void doc.ref.set({ ownerMorningAlertsEnabled: true }, { merge: true });
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

export function isMorningAlertHour(now = new Date()): boolean {
  const hour = manilaHour(now);
  return hour >= 5 && hour <= 10;
}
