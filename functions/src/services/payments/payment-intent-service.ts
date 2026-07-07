import crypto from "crypto";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type {
  CreateSubscriptionPaymentIntentInput,
  PaymentIntentRecord,
  SubscriptionBillingMode,
  SubscriptionPaymentAction,
} from "./payment-intent-types";
import { PaymongoRecurringService } from "./paymongo-recurring-service";
import { resolvePaymentProvider } from "./resolve-payment-provider";

const INTENT_TTL_HOURS = 48;

function intentsCol(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("payment_intents");
}

function serializeTimestamp(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return d.toISOString();
  }
  return new Date().toISOString();
}

function parseSubscriptionAction(value: unknown): SubscriptionPaymentAction {
  const raw = String(value || "").toUpperCase();
  if (raw === "RENEW") return "RENEW";
  if (raw === "DOWNGRADE") return "DOWNGRADE";
  return "UPGRADE";
}

function wantsAutoRenew(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  if (payload.autoRenew === true) return true;
  return payload.cancelAtPeriodEnd === false;
}

function toRecord(
  businessId: string,
  id: string,
  data: FirebaseFirestore.DocumentData,
): PaymentIntentRecord {
  const cycle = String(data.billingCycle || "monthly").toLowerCase();
  return {
    id,
    businessId,
    userId: String(data.userId || ""),
    targetPlanCode: String(data.targetPlanCode || ""),
    subscriptionAction: parseSubscriptionAction(data.subscriptionAction),
    billingCycle: cycle === "yearly" ? "yearly" : "monthly",
    billingMode: data.billingMode as SubscriptionBillingMode | undefined,
    amount: Number(data.amount || 0),
    currency: "PHP",
    provider: data.provider === "paymongo" ? "paymongo" : "mock",
    providerLinkId: data.providerLinkId ? String(data.providerLinkId) : undefined,
    providerReferenceNumber: data.providerReferenceNumber ?
      String(data.providerReferenceNumber) :
      undefined,
    providerSubscriptionId: data.providerSubscriptionId ?
      String(data.providerSubscriptionId) :
      undefined,
    providerCustomerId: data.providerCustomerId ?
      String(data.providerCustomerId) :
      undefined,
    checkoutUrl: String(data.checkoutUrl || ""),
    checkoutToken: String(data.checkoutToken || ""),
    status: data.status || "pending",
    paidAmount: data.paidAmount != null ? Number(data.paidAmount) : undefined,
    providerEventIds: Array.isArray(data.providerEventIds) ?
      data.providerEventIds.map(String) :
      undefined,
    reconcileNote: data.reconcileNote ? String(data.reconcileNote) : undefined,
    checkoutPayload:
      data.checkoutPayload && typeof data.checkoutPayload === "object" ?
        (data.checkoutPayload as Record<string, unknown>) :
        undefined,
    subscriptionId: data.subscriptionId ? String(data.subscriptionId) : undefined,
    source: "subscription",
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    expiresAt: serializeTimestamp(data.expiresAt),
  };
}

export class PaymentIntentService {
  static async getIntent(
    businessId: string,
    intentId: string,
  ): Promise<PaymentIntentRecord | null> {
    const snap = await intentsCol(businessId).doc(intentId).get();
    if (!snap.exists) return null;
    return toRecord(businessId, snap.id, snap.data() || {});
  }

  static async findByProviderReferenceNumber(
    referenceNumber: string,
  ): Promise<PaymentIntentRecord | null> {
    const ref = referenceNumber.trim();
    if (!ref) return null;
    const snap = await db
      .collectionGroup("payment_intents")
      .where("providerReferenceNumber", "==", ref)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const businessId = doc.ref.parent.parent?.id;
    if (!businessId) return null;
    return toRecord(businessId, doc.id, doc.data());
  }

  static async findByProviderLinkIdGlobal(
    providerLinkId: string,
  ): Promise<PaymentIntentRecord | null> {
    const linkId = providerLinkId.trim();
    if (!linkId) return null;
    const snap = await db
      .collectionGroup("payment_intents")
      .where("providerLinkId", "==", linkId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const businessId = doc.ref.parent.parent?.id;
    if (!businessId) return null;
    return toRecord(businessId, doc.id, doc.data());
  }

  static async findByProviderLinkId(
    businessId: string,
    providerLinkId: string,
  ): Promise<PaymentIntentRecord | null> {
    const snap = await intentsCol(businessId)
      .where("providerLinkId", "==", providerLinkId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return toRecord(businessId, doc.id, doc.data());
  }

  static async findByProviderSubscriptionId(
    businessId: string,
    providerSubscriptionId: string,
  ): Promise<PaymentIntentRecord | null> {
    const snap = await intentsCol(businessId)
      .where("providerSubscriptionId", "==", providerSubscriptionId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return toRecord(businessId, doc.id, doc.data());
  }

  static async createSubscriptionIntent(
    input: CreateSubscriptionPaymentIntentInput,
  ): Promise<PaymentIntentRecord> {
    const {
      businessId,
      userId,
      targetPlanCode,
      subscriptionAction,
      billingCycle,
      apiBaseUrl,
    } = input;

    const amount = Math.max(0, Number(input.amount || 0));
    if (!amount || amount <= 0) {
      throw new Error("NO_AMOUNT_DUE");
    }

    const planCode = String(targetPlanCode || "").trim().toLowerCase();
    if (!planCode) {
      throw new Error("PLAN_REQUIRED");
    }

    const intentId = `pi_${crypto.randomBytes(12).toString("hex")}`;
    const checkoutToken = crypto.randomBytes(18).toString("hex");
    const provider = resolvePaymentProvider();
    const expiresAt = new Date(Date.now() + INTENT_TTL_HOURS * 60 * 60 * 1000);
    const checkoutPayload = input.checkoutPayload || {};
    const autoRenew = wantsAutoRenew(checkoutPayload);

    let billingMode: SubscriptionBillingMode = "one_time";
    let checkoutUrl = "";
    let providerLinkId: string | undefined;
    let providerReferenceNumber: string | undefined;
    let providerSubscriptionId: string | undefined;
    let providerCustomerId: string | undefined;

    const useRecurring =
      autoRenew &&
      provider.id === "paymongo" &&
      PaymongoRecurringService.isEnabled() &&
      input.ownerEmail;

    if (useRecurring) {
      try {
        const recurring = await PaymongoRecurringService.createSubscriptionCheckout({
          businessId,
          ownerEmail: input.ownerEmail!,
          ownerName: input.ownerName,
          targetPlanCode: planCode,
          billingCycle,
          amount,
          metadata: {
            businessId,
            intentId,
            userId,
            targetPlanCode: planCode,
            subscriptionAction,
            source: "subscription",
          },
        });
        billingMode = "recurring";
        checkoutUrl = recurring.checkoutUrl;
        providerSubscriptionId = recurring.subscriptionId;
        providerCustomerId = recurring.customerId;
        providerLinkId = recurring.invoiceId;
      } catch (err) {
        logger.warn("PayMongo recurring checkout failed; falling back to link", {
          businessId,
          err: err instanceof Error ? err.message : err,
        });
      }
    }

    if (!checkoutUrl) {
      const link = await provider.createPaymentLink({
        businessId,
        intentId,
        amount,
        description:
          `SmartRefill ${subscriptionAction.toLowerCase()} — ${planCode} (₱${amount.toFixed(2)})`,
        metadata: {
          businessId,
          intentId,
          userId,
          targetPlanCode: planCode,
          subscriptionAction,
          source: "subscription",
        },
        apiBaseUrl,
        checkoutToken,
      });
      checkoutUrl = link.checkoutUrl;
      providerLinkId = link.providerLinkId;
      providerReferenceNumber = link.providerReferenceNumber;
      if (autoRenew) {
        billingMode = "recurring_link";
      }
    }

    const doc = {
      userId,
      targetPlanCode: planCode,
      subscriptionAction,
      billingCycle,
      billingMode,
      amount,
      currency: "PHP",
      provider: provider.id,
      providerLinkId,
      providerReferenceNumber,
      providerSubscriptionId,
      providerCustomerId,
      checkoutUrl,
      checkoutToken,
      status: "pending",
      source: "subscription",
      checkoutPayload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt,
    };

    await intentsCol(businessId).doc(intentId).set(doc);

    logger.info("subscription payment_intent created", {
      businessId,
      intentId,
      targetPlanCode: planCode,
      subscriptionAction,
      billingMode,
      amount,
      provider: provider.id,
    });

    const saved = await intentsCol(businessId).doc(intentId).get();
    return toRecord(businessId, intentId, saved.data() || doc);
  }

  static async patchIntent(
    businessId: string,
    intentId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await intentsCol(businessId).doc(intentId).update({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  static async assertCheckoutToken(
    businessId: string,
    intentId: string,
    token: string,
  ): Promise<PaymentIntentRecord> {
    const intent = await PaymentIntentService.getIntent(businessId, intentId);
    if (!intent) throw new Error("INTENT_NOT_FOUND");
    if (intent.checkoutToken !== token) throw new Error("INTENT_FORBIDDEN");
    if (intent.status !== "pending") throw new Error("INTENT_NOT_PENDING");
    if (new Date(intent.expiresAt).getTime() < Date.now()) {
      await PaymentIntentService.patchIntent(businessId, intentId, {
        status: "expired",
      });
      throw new Error("INTENT_EXPIRED");
    }
    return intent;
  }
}
