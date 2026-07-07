import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "../services/observability/logging/logger";
import { SubscriptionService } from "../services/subscriptions/subscription-service";
import {
  paymentReadyForActivation,
  promoteDueScheduledSubscriptions,
} from "../services/subscriptions/subscription-effective";
import { runSubscriptionLifecycleMaintenance } from "../services/subscriptions/subscription-lifecycle-maintenance";

/**
 * Subscription status transitions:
 * - `approved` → `scheduled` (if activatesAt in future) or `active` now
 * - Paid period ended → grace → expired → Starter downgrade (via lifecycle maintenance)
 */
export const onSubscriptionUpdated = onDocumentUpdated(
  {
    document: "businesses/{businessId}/subscriptions/{subscriptionId}",
    region: "asia-southeast1",
  },
  async (event) => {
    const newData = event.data?.after.data();
    const previousData = event.data?.before.data();
    const businessId = event.params.businessId;
    if (!newData || !event.data?.after.ref) return;

    if (newData.status === "approved" && previousData?.status !== "approved") {
      logger.info(
        `Subscription ${event.params.subscriptionId} approved; applying transition`,
      );
      await SubscriptionService.applyApprovalTransition(
        businessId,
        event.data.after.ref,
        newData as Record<string, unknown>,
      );
      return;
    }

    if (
      newData.status === "approved" &&
      paymentReadyForActivation(newData) &&
      previousData?.status === "approved" &&
      !paymentReadyForActivation(previousData ?? {})
    ) {
      logger.info(
        `Subscription ${event.params.subscriptionId} payment ready; applying transition`,
      );
      await SubscriptionService.applyApprovalTransition(
        businessId,
        event.data.after.ref,
        newData as Record<string, unknown>,
      );
      return;
    }

    await promoteDueScheduledSubscriptions(businessId);
    await runSubscriptionLifecycleMaintenance(businessId);
  },
);
