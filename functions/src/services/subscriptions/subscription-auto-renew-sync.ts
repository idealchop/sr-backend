import { FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { PaymentIntentRecord } from "../payments/payment-intent-types";
import { PaymongoRecurringService } from "../payments/paymongo-recurring-service";
import { wantsAutoRenewFromPayload } from "./subscription-auto-renew-policy";
import {
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "./subscription-effective";

/** Keep the current period opted-in when a renewal payment succeeds. */
export async function reEnableAutoRenewOnCurrentPlan(
  businessId: string,
): Promise<void> {
  const now = new Date();
  const rows = await fetchRecentSubscriptionRows(businessId);
  const effective = pickEffectiveEntitling(rows, now);
  if (effective?.data.cancelAtPeriodEnd === true) {
    await effective.ref.update({
      "cancelAtPeriodEnd": false,
      "dates.cancelledAt": FieldValue.delete(),
      "updatedAt": FieldValue.serverTimestamp(),
    });
    logger.info("auto-renew re-enabled on current subscription", {
      businessId,
      subscriptionId: effective.id,
    });
  }
}

export async function syncAutoRenewAfterSubscriptionPayment(
  businessId: string,
  intent: PaymentIntentRecord,
  checkoutPayload: Record<string, unknown>,
): Promise<void> {
  if (!wantsAutoRenewFromPayload(checkoutPayload)) return;

  await reEnableAutoRenewOnCurrentPlan(businessId);

  if (
    intent.billingMode === "recurring" ||
    intent.providerSubscriptionId
  ) {
    await PaymongoRecurringService.markBillingActive(businessId);
  }
}
