import { FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { SubscriptionService } from "./subscription-service";
import {
  computeDatesView,
  fetchRecentSubscriptionRows,
  isPaidBillingCycle,
  isStarterPlan,
  pickEffectiveEntitling,
  promoteDueScheduledSubscriptions,
} from "./subscription-effective";

export type LifecycleMaintenanceResult = {
  graceEntered: boolean;
  graceEnded: boolean;
  downgradedToStarter: boolean;
};

/**
 * Advances paid subscriptions through grace → expired → Starter downgrade.
 * Trial rows skip grace; expiry is handled via ensureStarterWhenNoPaidAccess.
 */
export async function runSubscriptionLifecycleMaintenance(
  businessId: string,
): Promise<LifecycleMaintenanceResult> {
  const result: LifecycleMaintenanceResult = {
    graceEntered: false,
    graceEnded: false,
    downgradedToStarter: false,
  };

  await promoteDueScheduledSubscriptions(businessId);

  const now = new Date();
  const rows = await fetchRecentSubscriptionRows(businessId);
  const effective = pickEffectiveEntitling(rows, now);

  for (const row of rows) {
    if (row.ref.path === effective?.ref.path) continue;
    const cycle = String(row.data.billingCycle || "");
    if (!isPaidBillingCycle(cycle)) continue;
    const persisted = String(row.data.status || "");
    if (persisted !== "active" && persisted !== "grace_period") continue;

    const view = computeDatesView(row.data, now);
    if (view.isExpired) {
      await row.ref.update({
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (
      view.isGracePeriod &&
      persisted === "active" &&
      now > view.expiresAt
    ) {
      await row.ref.update({
        status: "grace_period",
        updatedAt: FieldValue.serverTimestamp(),
      });
      result.graceEntered = true;
    }
  }

  const current = pickEffectiveEntitling(
    await fetchRecentSubscriptionRows(businessId),
    now,
  );
  if (!current) {
    const before = effective;
    await SubscriptionService.ensureStarterWhenNoPaidAccess(businessId);
    const after = pickEffectiveEntitling(
      await fetchRecentSubscriptionRows(businessId),
      now,
    );
    if (
      before &&
      !isStarterPlan(String(before.data.planCode || "")) &&
      after &&
      isStarterPlan(String(after.data.planCode || ""))
    ) {
      result.graceEnded = true;
      result.downgradedToStarter = true;
    }
    return result;
  }

  const code = String(current.data.planCode || "").toLowerCase();
  const view = computeDatesView(current.data, now);
  const persisted = String(current.data.status || "");

  if (
    isPaidBillingCycle(String(current.data.billingCycle || "")) &&
    view.isGracePeriod &&
    persisted === "active" &&
    now > view.expiresAt
  ) {
    await current.ref.update({
      status: "grace_period",
      updatedAt: FieldValue.serverTimestamp(),
    });
    result.graceEntered = true;
  }

  if (
    isPaidBillingCycle(String(current.data.billingCycle || "")) &&
    view.isExpired &&
    !isStarterPlan(code)
  ) {
    if (persisted !== "expired") {
      await current.ref.update({
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await SubscriptionService.handleAutoDowngrade(businessId);
    result.graceEnded = true;
    result.downgradedToStarter = true;
    logger.info("subscription lifecycle: grace ended, downgraded to starter", {
      businessId,
      subscriptionId: current.id,
    });
  }

  return result;
}
