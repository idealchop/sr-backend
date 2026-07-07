import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import {
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "../services/subscriptions/subscription-effective";
import { PaymentIntentService } from "../services/payments/payment-intent-service";
import { PaymongoRecurringService } from "../services/payments/paymongo-recurring-service";
import { NotificationService } from "../services/notifications/notification-service";

const RENEWAL_LEAD_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
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
 * Creates link-based renewal payment intents before period end when auto-renew
 * is enabled but PayMongo Subscriptions API is unavailable.
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
    const windowEnd = new Date(now.getTime() + RENEWAL_LEAD_DAYS * MS_PER_DAY);
    const businessesSnap = await db.collection("businesses").select().get();
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
        if (
          !planCode ||
          planCode === "starter" ||
          planCode === "free" ||
          cycle === "trial"
        ) {
          continue;
        }

        if (data.cancelAtPeriodEnd === true) continue;

        const dates = (data.dates || {}) as { expiresAt?: unknown };
        const expiresAt = toDate(dates.expiresAt);
        if (!expiresAt || expiresAt <= now || expiresAt > windowEnd) continue;

        const billing = await PaymongoRecurringService.getBillingProfile(businessId);
        const pmStatus = String(billing?.status || "").toLowerCase();
        if (
          billing?.subscriptionId &&
          (pmStatus === "active" || pmStatus === "trialing")
        ) {
          continue;
        }

        if (await hasPendingRenewIntent(businessId, planCode)) continue;

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

        const amount = Number(data.price || 0);
        if (!amount || amount <= 0) continue;

        const billingCycle =
          cycle === "yearly" ? "yearly" as const : "monthly" as const;

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
          },
          ownerEmail: ownerEmail || undefined,
          ownerName: ownerName || undefined,
          apiBaseUrl:
            process.env.PUBLIC_API_BASE_URL?.trim() ||
            "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api",
        });

        await NotificationService.send({
          userId: ownerId,
          businessId,
          title: "Subscription renewal due",
          message:
            `Your ${String(data.planName || planCode)} plan renews soon. ` +
            "Open the payment link to keep auto-renewal active.",
          type: "info",
          metadata: {
            checkoutUrl: intent.checkoutUrl,
            intentId: intent.id,
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
