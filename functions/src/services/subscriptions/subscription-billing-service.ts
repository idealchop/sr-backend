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
  /** Start a first-time vault checkout. */
  canLink: boolean;
  /** Replace / finish payment method when already linked or incomplete. */
  canUpdate: boolean;
  billingMode: "none" | "recurring" | "recurring_link" | "mock";
  status: "none" | "incomplete" | "active" | "past_due" | "cancelled";
  paymentMethodLabel?: string;
  customerId?: string;
  subscriptionId?: string;
  message?: string;
};

export type CreateBillingLinkResult = {
  checkoutUrl: string;
  alreadyLinked?: boolean;
  intentId?: string;
  billingMode?: string;
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
  /**
   * Mock / fallback vault marker after a billing_link payment succeeds.
   * Prefer real PayMongo customer/subscription ids when the intent already has them.
   */
  static async completeBillingLinkSetup(
    businessId: string,
    intentId: string,
    provider = "mock",
    ids?: { customerId?: string; subscriptionId?: string },
  ): Promise<void> {
    const prefix = provider === "paymongo" ? "paymongo" : "mock";
    const customerId =
      String(ids?.customerId || "").trim() ||
      `${prefix}_cus_${intentId.slice(0, 12)}`;
    const subscriptionId =
      String(ids?.subscriptionId || "").trim() ||
      `${prefix}_sub_${intentId.slice(0, 12)}`;

    await billingDoc(businessId).set(
      {
        customerId,
        subscriptionId,
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
          canUpdate: true,
          billingMode: "mock",
          status: "active",
          paymentMethodLabel: "Mock GCash",
          customerId: String(stored?.customerId || "") || undefined,
          subscriptionId: String(stored?.subscriptionId || "") || undefined,
          message: "Test billing account linked (dev/emulator).",
        };
      }
      return {
        linked: false,
        canAutoCharge: false,
        canLink: true,
        canUpdate: false,
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
        canUpdate: false,
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
        canUpdate: false,
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
    const incomplete = liveStatus === "incomplete";
    const canAutoCharge = linked;

    return {
      linked,
      canAutoCharge,
      canLink: !linked && !incomplete,
      canUpdate: linked || incomplete,
      billingMode: linked ? "recurring" : incomplete ? "none" : "none",
      status: liveStatus === "none" ? storedStatus : liveStatus,
      paymentMethodLabel,
      customerId: customerId || undefined,
      subscriptionId,
      message: linked ?
        "Your billing account is linked. Renewals can charge automatically." :
        incomplete ?
          "Finish linking your billing account in PayMongo checkout." :
          "Link a payment account for automatic renewals.",
    };
  }

  /**
   * Start (or replace) vaulted billing via a RENEW payment intent.
   * First successful charge extends the plan and marks paymongo_billing active.
   */
  static async createLinkSession(
    businessId: string,
    userId: string,
    apiBaseUrl: string,
    options?: { update?: boolean },
  ): Promise<CreateBillingLinkResult> {
    const update = options?.update === true;
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

    const profile = await SubscriptionBillingService.getProfile(businessId);

    if (provider.id === "paymongo" && !paymongoRecurringEnabled()) {
      throw new Error("BILLING_LINK_UNAVAILABLE");
    }

    if (profile.linked && profile.canAutoCharge && !update) {
      return { checkoutUrl: "", alreadyLinked: true };
    }

    if (update && (profile.linked || profile.status === "incomplete")) {
      try {
        await PaymongoRecurringService.cancelSubscription(businessId);
      } catch (err) {
        logger.warn("billing update: cancel previous PayMongo subscription failed", {
          businessId,
          err: err instanceof Error ? err.message : err,
        });
      }
    }

    const billingCycle = cycle === "yearly" ? ("yearly" as const) : ("monthly" as const);

    let ownerEmail: string | undefined;
    let ownerName: string | undefined;
    if (provider.id === "paymongo") {
      const uSnap = await db.collection("users").doc(userId).get();
      const u = uSnap.exists ? (uSnap.data() as Record<string, unknown>) : {};
      ownerEmail = String(u.email || "").trim() || undefined;
      ownerName = String(u.displayName || u.name || "").trim() || undefined;
      if (!ownerEmail) throw new Error("OWNER_EMAIL_REQUIRED");
    }

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
        billingSetup: true,
        billingUpdate: update,
        billingCycle,
      },
      ownerEmail,
      ownerName,
      apiBaseUrl,
    });

    await billingDoc(businessId).set(
      {
        ...(intent.providerCustomerId ?
          { customerId: intent.providerCustomerId } :
          {}),
        ...(intent.providerSubscriptionId ?
          { subscriptionId: intent.providerSubscriptionId } :
          {}),
        status: "incomplete",
        linkPurpose: "billing_setup",
        linkIntentId: intent.id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info("billing link session created", {
      businessId,
      intentId: intent.id,
      provider: intent.provider,
      billingMode: intent.billingMode,
      update,
    });

    return {
      checkoutUrl: intent.checkoutUrl,
      intentId: intent.id,
      billingMode: intent.billingMode,
    };
  }
}
