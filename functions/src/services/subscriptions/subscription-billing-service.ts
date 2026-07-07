import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { paymongoRequest, paymongoRecurringEnabled } from "../payments/paymongo-api-client";
import { PaymongoRecurringService } from "../payments/paymongo-recurring-service";
import { PaymentIntentService } from "../payments/payment-intent-service";
import { resolvePaymentProvider } from "../payments/resolve-payment-provider";
import {
  fetchRecentSubscriptionRows,
  isPaidBillingCycle,
  isStarterPlan,
  pickEffectiveEntitling,
} from "./subscription-effective";

export type SubscriptionBillingProfile = {
  linked: boolean;
  canAutoCharge: boolean;
  canLink: boolean;
  billingMode: "none" | "recurring" | "recurring_link" | "mock";
  status: "none" | "incomplete" | "active" | "past_due" | "cancelled";
  paymentMethodLabel?: string;
  customerId?: string;
  subscriptionId?: string;
  message?: string;
};

type PaymongoSubscriptionResponse = {
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      default_customer_payment_method_id?: string;
      latest_invoice?: {
        payment_intent?: {
          attributes?: {
            source?: { type?: string; brand?: string; last4?: string };
          };
        };
      };
    };
  };
};

function billingDoc(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("paymongo_billing")
    .doc("default");
}

function formatPaymentMethodLabel(source?: {
  type?: string;
  brand?: string;
  last4?: string;
}): string | undefined {
  if (!source?.type) return undefined;
  const type = String(source.type).toLowerCase();
  if (type === "card") {
    const brand = String(source.brand || "Card").trim();
    const last4 = String(source.last4 || "").trim();
    return last4 ? `${brand} •••• ${last4}` : brand;
  }
  if (type === "gcash") return "GCash";
  if (type === "maya" || type === "paymaya") return "Maya";
  if (type === "qrph") return "QR Ph";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function normalizePaymongoStatus(raw: string): SubscriptionBillingProfile["status"] {
  const s = raw.trim().toLowerCase();
  if (s === "active" || s === "trialing") return "active";
  if (s === "incomplete" || s === "incomplete_expired") return "incomplete";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "none";
}

export class SubscriptionBillingService {
  static async completeBillingLinkSetup(
    businessId: string,
    intentId: string,
    provider: string = "mock",
  ): Promise<void> {
    const prefix = provider === "paymongo" ? "paymongo" : "mock";
    await billingDoc(businessId).set(
      {
        customerId: `${prefix}_cus_${intentId.slice(0, 12)}`,
        subscriptionId: `${prefix}_sub_${intentId.slice(0, 12)}`,
        status: "active",
        linkPurpose: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  static async getProfile(businessId: string): Promise<SubscriptionBillingProfile> {
    const provider = resolvePaymentProvider();
    if (provider.id === "mock") {
      const stored = await PaymongoRecurringService.getBillingProfile(businessId);
      const linked = String(stored?.status || "").toLowerCase() === "active";
      if (linked) {
        return {
          linked: true,
          canAutoCharge: true,
          canLink: false,
          billingMode: "mock",
          status: "active",
          paymentMethodLabel: "Mock GCash",
          message: "Test billing account linked (dev/emulator).",
        };
      }
      return {
        linked: false,
        canAutoCharge: false,
        canLink: true,
        billingMode: "mock",
        status: "none",
        message: "Test mode — link billing is simulated at checkout.",
      };
    }

    if (!paymongoRecurringEnabled()) {
      return {
        linked: false,
        canAutoCharge: false,
        canLink: false,
        billingMode: "recurring_link",
        status: "none",
        message:
          "Wallet auto-charge is not enabled on this environment. Renewals use payment links.",
      };
    }

    const stored = await PaymongoRecurringService.getBillingProfile(businessId);
    const subscriptionId = String(stored?.subscriptionId || "").trim();
    const customerId = String(stored?.customerId || "").trim();
    const storedStatus = normalizePaymongoStatus(String(stored?.status || ""));

    if (!subscriptionId) {
      return {
        linked: false,
        canAutoCharge: false,
        canLink: true,
        billingMode: "none",
        status: "none",
        customerId: customerId || undefined,
        message: "Link a GCash, Maya, or card account for automatic subscription billing.",
      };
    }

    let paymentMethodLabel: string | undefined;
    let liveStatus = storedStatus;

    try {
      const json = await paymongoRequest<PaymongoSubscriptionResponse>({
        method: "GET",
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      });
      const attrs = json.data?.attributes;
      liveStatus = normalizePaymongoStatus(String(attrs?.status || stored?.status || ""));
      paymentMethodLabel = formatPaymentMethodLabel(
        attrs?.latest_invoice?.payment_intent?.attributes?.source,
      );
    } catch (err) {
      logger.warn("PayMongo subscription fetch for billing profile failed", {
        businessId,
        subscriptionId,
        err: err instanceof Error ? err.message : err,
      });
    }

    const linked = liveStatus === "active" || liveStatus === "past_due";
    const canAutoCharge = linked;

    return {
      linked,
      canAutoCharge,
      canLink: !linked,
      billingMode: linked ? "recurring" : "none",
      status: liveStatus === "none" ? storedStatus : liveStatus,
      paymentMethodLabel,
      customerId: customerId || undefined,
      subscriptionId,
      message: linked ?
        "Your billing account is linked. Renewals can charge automatically." :
        liveStatus === "incomplete" ?
          "Finish linking your billing account in PayMongo checkout." :
          "Link a payment account for automatic renewals.",
    };
  }

  static async createLinkSession(
    businessId: string,
    userId: string,
    apiBaseUrl: string,
  ): Promise<{ checkoutUrl: string; alreadyLinked?: boolean }> {
    const provider = resolvePaymentProvider();

    const rows = await fetchRecentSubscriptionRows(businessId);
    const effective = pickEffectiveEntitling(rows, new Date());
    if (!effective) throw new Error("NO_ACTIVE_SUBSCRIPTION");

    const planCode = String(effective.data.planCode || "").toLowerCase();
    const cycle = String(effective.data.billingCycle || "monthly").toLowerCase();
    if (isStarterPlan(planCode) || !isPaidBillingCycle(cycle)) {
      throw new Error("PLAN_NOT_ELIGIBLE");
    }

    const amount = Number(effective.data.price || 0);
    if (!amount || amount <= 0) throw new Error("NO_AMOUNT_DUE");

    if (provider.id === "mock") {
      const profile = await SubscriptionBillingService.getProfile(businessId);
      if (profile.linked && profile.canAutoCharge) {
        return { checkoutUrl: "", alreadyLinked: true };
      }

      const billingCycle = cycle === "yearly" ? "yearly" as const : "monthly" as const;
      const intent = await PaymentIntentService.createSubscriptionIntent({
        businessId,
        userId,
        targetPlanCode: planCode,
        subscriptionAction: "RENEW",
        billingCycle,
        amount,
        checkoutPayload: {
          autoRenew: true,
          cancelAtPeriodEnd: false,
          purpose: "billing_link",
          billingCycle,
        },
        apiBaseUrl,
      });
      return { checkoutUrl: intent.checkoutUrl };
    }

    if (!paymongoRecurringEnabled()) {
      throw new Error("BILLING_LINK_UNAVAILABLE");
    }

    const profile = await SubscriptionBillingService.getProfile(businessId);
    if (profile.linked && profile.canAutoCharge) {
      return { checkoutUrl: "", alreadyLinked: true };
    }

    const uSnap = await db.collection("users").doc(userId).get();
    const u = uSnap.exists ? (uSnap.data() as Record<string, unknown>) : {};
    const ownerEmail = String(u.email || "").trim();
    const ownerName = String(u.displayName || u.name || "").trim();
    if (!ownerEmail) throw new Error("OWNER_EMAIL_REQUIRED");

    const billingCycle = cycle === "yearly" ? "yearly" as const : "monthly" as const;

    const recurring = await PaymongoRecurringService.createSubscriptionCheckout({
      businessId,
      ownerEmail,
      ownerName: ownerName || undefined,
      targetPlanCode: planCode,
      billingCycle,
      amount,
      metadata: {
        businessId,
        userId,
        targetPlanCode: planCode,
        subscriptionAction: "RENEW",
        source: "subscription",
        purpose: "billing_link",
      },
    });

    await billingDoc(businessId).set(
      {
        customerId: recurring.customerId,
        planId: recurring.planId,
        subscriptionId: recurring.subscriptionId,
        status: "incomplete",
        linkPurpose: "billing_setup",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { checkoutUrl: recurring.checkoutUrl };
  }
}
