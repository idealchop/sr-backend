import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import {
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "../services/subscriptions/subscription-effective";
import {
  hasQueuedPaidRenewal,
  subscriptionRowEligibleForLinkRenewal,
} from "../services/subscriptions/subscription-auto-renew-policy";
import { PaymentIntentService } from "../services/payments/payment-intent-service";
import { PaymongoRecurringService } from "../services/payments/paymongo-recurring-service";
import { NotificationService } from "../services/notifications/notification-service";
import {
  buildAddonCatalogLookupFromRows,
  buildRenewalAddonCheckout,
  type AddonCatalogRow,
} from "../utils/subscription-renewal-addons";

const RENEWAL_LEAD_DAYS = 3;

async function fetchAddonCatalogLookup(): Promise<Map<string, AddonCatalogRow>> {
  const snap = await db.collection("subscription_addons").get();
  const rows: AddonCatalogRow[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));
  return buildAddonCatalogLookupFromRows(rows);
}

async function resolvePlanLineAmount(
  data: Record<string, unknown>,
  billingCycle: "monthly" | "yearly",
): Promise<number> {
  const planId = String(data.planId || "").trim();
  if (planId) {
    const planSnap = await db.collection("subscription_plans").doc(planId).get();
    if (planSnap.exists) {
      const pricing = (planSnap.data() as { pricing?: { monthly?: number; yearly?: number } })
        ?.pricing;
      const fromPlan =
        billingCycle === "yearly" ?
          Number(pricing?.yearly) :
          Number(pricing?.monthly);
      if (fromPlan > 0) return fromPlan;
    }
  }
  return Math.max(0, Number(data.price) || 0);
}

async function hasPendingRenewIntent(
  businessId: string,
  planCode: string,
): Promise<boolean> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("payment_intents")
    .where("subscriptionAction", "==", "RENEW")
    .where("targetPlanCode", "==", planCode)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Creates link-based renewal payment intents before period end (or during grace)
 * when auto-renew is enabled but PayMongo Subscriptions API is unavailable.
 */
export const subscriptionAutoRenewScheduler = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: ["PAYMONGO_SECRET_KEY"],
  },
  async () => {
    const now = new Date();
    const businessesSnap = await db.collection("businesses").select().get();
    const addonCatalogLookup = await fetchAddonCatalogLookup();
    let created = 0;

    for (const businessDoc of businessesSnap.docs) {
      const businessId = businessDoc.id;
      try {
        const rows = await fetchRecentSubscriptionRows(businessId);
        const effective = pickEffectiveEntitling(rows, now);
        if (!effective) continue;

        const data = effective.data;
        const planCode = String(data.planCode || "").toLowerCase();
        const cycle = String(data.billingCycle || "").toLowerCase();

        const billing = await PaymongoRecurringService.getBillingProfile(businessId);
        const pmStatus = String(billing?.status || "").toLowerCase();
        const hasActivePaymongoSubscription =
          !!billing?.subscriptionId &&
          (pmStatus === "active" || pmStatus === "trialing");

        const eligible = subscriptionRowEligibleForLinkRenewal({
          row: effective,
          now,
          leadDays: RENEWAL_LEAD_DAYS,
          hasActivePaymongoSubscription,
          hasPendingRenewIntent: await hasPendingRenewIntent(businessId, planCode),
          hasQueuedPaidRenewal: hasQueuedPaidRenewal(rows, planCode, now),
        });
        if (!eligible) continue;

        const ownerId = String(
          (await businessDoc.ref.get()).data()?.ownerId || "",
        ).trim();
        if (!ownerId) continue;

        let ownerEmail = "";
        let ownerName = "";
        const uSnap = await db.collection("users").doc(ownerId).get();
        if (uSnap.exists) {
          const u = uSnap.data() as Record<string, unknown>;
          ownerEmail = String(u.email || "").trim();
          ownerName = String(u.displayName || u.name || "").trim();
        }

        const billingCycle =
          cycle === "yearly" ? "yearly" as const : "monthly" as const;

        const planLineAmount = await resolvePlanLineAmount(
          data as Record<string, unknown>,
          billingCycle,
        );
        const { addonLineItems, addonsTotal } = buildRenewalAddonCheckout(
          data as Record<string, unknown>,
          addonCatalogLookup,
          billingCycle,
        );
        const amount = planLineAmount + addonsTotal;
        if (!amount || amount <= 0) continue;

        const intent = await PaymentIntentService.createSubscriptionIntent({
          businessId,
          userId: ownerId,
          targetPlanCode: planCode,
          subscriptionAction: "RENEW",
          billingCycle,
          amount,
          checkoutPayload: {
            autoRenew: true,
            cancelAtPeriodEnd: false,
            billingCycle,
            planLineAmount,
            addonsTotal,
            addonLineItems,
          },
          ownerEmail: ownerEmail || undefined,
          ownerName: ownerName || undefined,
          apiBaseUrl:
            process.env.PUBLIC_API_BASE_URL?.trim() ||
            "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api",
        });

        const planLabel = String(data.planName || planCode);
        await NotificationService.send({
          userId: ownerId,
          businessId,
          title: "Subscription renewal due",
          message:
            `Your ${planLabel} plan needs renewal to stay active. ` +
            `Pay online: ${intent.checkoutUrl}`,
          type: "info",
          metadata: {
            checkoutUrl: intent.checkoutUrl,
            intentId: intent.id,
            kind: "subscription_renewal",
          },
        });

        created += 1;
      } catch (error) {
        logger.error("subscriptionAutoRenewScheduler business failed", {
          businessId,
          error,
        });
      }
    }

    logger.info("subscriptionAutoRenewScheduler complete", {
      businesses: businessesSnap.size,
      created,
    });
  },
);
