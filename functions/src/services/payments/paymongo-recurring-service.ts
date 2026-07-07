import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  amountToCentavos,
  paymongoRecurringEnabled,
  paymongoRequest,
} from "./paymongo-api-client";

type PaymongoCustomer = {
  data?: { id?: string };
};

type PaymongoPlan = {
  data?: { id?: string };
};

type PaymongoSubscription = {
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      latest_invoice?: {
        id?: string;
        payment_intent?: {
          id?: string;
          attributes?: {
            next_action?: {
              redirect?: { url?: string };
            };
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

function planCacheDoc(planKey: string) {
  return db.collection("platform").doc("paymongo_plans").collection("items").doc(planKey);
}

function splitOwnerName(raw: string): { first: string; last: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Station", last: "Owner" };
  if (parts.length === 1) return { first: parts[0], last: "Owner" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export type RecurringCheckoutInput = {
  businessId: string;
  ownerEmail: string;
  ownerName?: string;
  targetPlanCode: string;
  billingCycle: "monthly" | "yearly";
  amount: number;
  metadata: Record<string, string>;
};

export type RecurringCheckoutResult = {
  customerId: string;
  planId: string;
  subscriptionId: string;
  checkoutUrl: string;
  invoiceId?: string;
};

export class PaymongoRecurringService {
  static isEnabled(): boolean {
    return paymongoRecurringEnabled();
  }

  static async getBillingProfile(businessId: string) {
    const snap = await billingDoc(businessId).get();
    return snap.exists ? snap.data() : null;
  }

  static async ensureCustomer(
    businessId: string,
    email: string,
    ownerName?: string,
  ): Promise<string> {
    const ref = billingDoc(businessId);
    const existing = await ref.get();
    const customerId = String(existing.data()?.customerId || "").trim();
    if (customerId) return customerId;

    const { first, last } = splitOwnerName(ownerName || "");
    const json = await paymongoRequest<PaymongoCustomer>({
      method: "POST",
      path: "/v1/customers",
      body: {
        data: {
          attributes: {
            first_name: first.slice(0, 80),
            last_name: last.slice(0, 80),
            email: email.slice(0, 120),
            default_device: "email",
            metadata: { businessId },
          },
        },
      },
    });

    const id = String(json.data?.id || "").trim();
    if (!id) throw new Error("PAYMONGO_CUSTOMER_INVALID");

    await ref.set(
      {
        customerId: id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return id;
  }

  static async ensurePlan(
    planCode: string,
    billingCycle: "monthly" | "yearly",
    amount: number,
  ): Promise<string> {
    const planKey = `${planCode}_${billingCycle}`;
    const cacheRef = planCacheDoc(planKey);
    const cached = await cacheRef.get();
    const cachedId = String(cached.data()?.planId || "").trim();
    if (cachedId) return cachedId;

    const interval = billingCycle === "yearly" ? "yearly" : "monthly";
    const json = await paymongoRequest<PaymongoPlan>({
      method: "POST",
      path: "/v1/plans",
      body: {
        data: {
          attributes: {
            amount: amountToCentavos(amount),
            currency: "PHP",
            interval,
            interval_count: 1,
            name: `SmartRefill ${planCode} ${billingCycle}`,
            description: `SmartRefill subscription ${planCode} (${billingCycle})`,
          },
        },
      },
    });

    const planId = String(json.data?.id || "").trim();
    if (!planId) throw new Error("PAYMONGO_PLAN_INVALID");

    await cacheRef.set({
      planId,
      planCode,
      billingCycle,
      amount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return planId;
  }

  static async createSubscriptionCheckout(
    input: RecurringCheckoutInput,
  ): Promise<RecurringCheckoutResult> {
    const customerId = await PaymongoRecurringService.ensureCustomer(
      input.businessId,
      input.ownerEmail,
      input.ownerName,
    );
    const planId = await PaymongoRecurringService.ensurePlan(
      input.targetPlanCode,
      input.billingCycle,
      input.amount,
    );

    const json = await paymongoRequest<PaymongoSubscription>({
      method: "POST",
      path: "/v1/subscriptions",
      body: {
        data: {
          attributes: {
            customer_id: customerId,
            plan_id: planId,
            metadata: input.metadata,
          },
        },
      },
    });

    const subscriptionId = String(json.data?.id || "").trim();
    const invoice = json.data?.attributes?.latest_invoice;
    const checkoutUrl =
      invoice?.payment_intent?.attributes?.next_action?.redirect?.url || "";
    if (!subscriptionId || !checkoutUrl) {
      throw new Error("PAYMONGO_SUBSCRIPTION_CHECKOUT_INVALID");
    }

    await billingDoc(input.businessId).set(
      {
        customerId,
        planId,
        subscriptionId,
        status: String(json.data?.attributes?.status || "incomplete"),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info("PayMongo recurring subscription created", {
      businessId: input.businessId,
      subscriptionId,
      planId,
    });

    return {
      customerId,
      planId,
      subscriptionId,
      checkoutUrl,
      invoiceId: invoice?.id,
    };
  }

  static async cancelSubscription(businessId: string): Promise<void> {
    const profile = await PaymongoRecurringService.getBillingProfile(businessId);
    const subscriptionId = String(profile?.subscriptionId || "").trim();
    if (!subscriptionId) return;

    try {
      await paymongoRequest({
        method: "POST",
        path: `/v1/subscriptions/${subscriptionId}/cancel`,
        body: {
          data: {
            attributes: {
              cancellation_reason: "customer_request",
            },
          },
        },
      });
    } catch (err) {
      logger.warn("PayMongo subscription cancel failed", {
        businessId,
        subscriptionId,
        err,
      });
    }

    await billingDoc(businessId).set(
      {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}
