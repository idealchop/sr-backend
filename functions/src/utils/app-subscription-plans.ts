import { db } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";

/** Document id under `apps` for the SmartRefill web app row (holds `subscriptionPlans`). */
export const DEFAULT_SMARTREFILL_APP_DOC_ID = "smartrefill";

/**
 * Values under `subscriptionPlans` that are not Firestore document ids in `subscription_plans`.
 */
const NON_REGISTRY_PLAN_MARKERS = new Set(["enterprise", "custom"]);

/**
 * Maps a subscription / checkout `planCode` to the key stored under `apps.*.subscriptionPlans`.
 * Returns null when the tier should not be resolved via the app registry (enterprise / custom).
 * @param {string} planCode The code of the plan.
 * @return {string | null} The map key or null.
 */
export function subscriptionPlanAppMapKey(planCode: string): string | null {
  const c = String(planCode || "")
    .trim()
    .toLowerCase();
  if (!c) return null;
  if (NON_REGISTRY_PLAN_MARKERS.has(c)) return null;
  if (c === "pro") return "grow";
  return c;
}

/**
 * Reads `apps/{appDocId}.subscriptionPlans.{tierKey}` as a `subscription_plans` document id.
 * Skips enterprise/custom placeholders so those tiers continue to resolve elsewhere.
 * @param {string} planCode The code of the plan.
 * @param {string} appDocId The ID of the app document.
 * @return {Promise<string | null>} The document ID or null.
 */
export async function getDocIdFromAppSubscriptionPlans(
  planCode: string,
  appDocId: string = process.env.SMARTREFILL_APP_DOC_ID ||
    DEFAULT_SMARTREFILL_APP_DOC_ID,
): Promise<string | null> {
  const mapKey = subscriptionPlanAppMapKey(planCode);
  if (!mapKey) return null;

  try {
    const snap = await db.collection("apps").doc(appDocId).get();
    if (!snap.exists) return null;
    const plans = snap.data()?.subscriptionPlans;
    if (!plans || typeof plans !== "object") return null;
    const ref = String((plans as Record<string, unknown>)[mapKey] ?? "").trim();
    if (!ref) return null;
    if (NON_REGISTRY_PLAN_MARKERS.has(ref.toLowerCase())) return null;
    return ref;
  } catch (e) {
    logger.warn("getDocIdFromAppSubscriptionPlans failed", {
      planCode,
      appDocId,
      error: e,
    });
    return null;
  }
}
