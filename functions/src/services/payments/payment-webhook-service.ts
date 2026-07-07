import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { PaymentIntentService } from "./payment-intent-service";
import type {
  PaymentProviderId,
  SubscriptionPaymentAction,
} from "./payment-intent-types";
import { getPaymentProviderById } from "./resolve-payment-provider";

export type ProcessPaymentWebhookInput = {
  provider: PaymentProviderId;
  rawBody: Buffer | string;
  signatureHeader?: string;
  parsedBody: unknown;
};

export type ProcessPaymentWebhookResult = {
  ok: boolean;
  duplicate?: boolean;
  intentId?: string;
  status?: string;
  error?: string;
};

export class PaymentWebhookService {
  static async processWebhook(
    input: ProcessPaymentWebhookInput,
  ): Promise<ProcessPaymentWebhookResult> {
    const provider = getPaymentProviderById(input.provider);

    if (!provider.verifyWebhookSignature(input.rawBody, input.signatureHeader)) {
      return { ok: false, error: "INVALID_SIGNATURE" };
    }

    const parsed = provider.parseWebhookPayload(input.parsedBody);
    if (!parsed) {
      return { ok: false, error: "INVALID_PAYLOAD" };
    }

    const metadata = extractMetadata(input.parsedBody);
    let businessId = metadata.businessId;

    if (!businessId && parsed.providerSubscriptionId) {
      businessId = await resolveBusinessByPaymongoSubscription(
        parsed.providerSubscriptionId,
      );
    }

    if (!businessId) {
      return { ok: false, error: "MISSING_BUSINESS" };
    }

    let intent = parsed.intentId ?
      await PaymentIntentService.getIntent(businessId, parsed.intentId) :
      null;

    if (!intent && parsed.providerLinkId) {
      intent = await PaymentIntentService.findByProviderLinkId(
        businessId,
        parsed.providerLinkId,
      );
    }

    if (!intent && parsed.providerSubscriptionId) {
      intent = await PaymentIntentService.findByProviderSubscriptionId(
        businessId,
        parsed.providerSubscriptionId,
      );
    }

    if (!intent) {
      logger.warn("payment webhook unmatched intent", {
        businessId,
        providerEventId: parsed.providerEventId,
      });
      return { ok: false, error: "INTENT_NOT_FOUND", status: "unmatched" };
    }

    if (intent.source !== "subscription") {
      return {
        ok: false,
        error: "UNSUPPORTED_INTENT",
        intentId: intent.id,
        status: "unmatched",
      };
    }

    const priorEvents = intent.providerEventIds || [];
    if (priorEvents.includes(parsed.providerEventId)) {
      return {
        ok: true,
        duplicate: true,
        intentId: intent.id,
        status: intent.status,
      };
    }

    const isRecurringRenewal =
      parsed.eventKind === "subscription_invoice" && intent.status === "paid";

    if (intent.subscriptionId && intent.status === "paid" && !isRecurringRenewal) {
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        providerEventIds: [...priorEvents, parsed.providerEventId],
      });
      return {
        ok: true,
        duplicate: true,
        intentId: intent.id,
        status: intent.status,
      };
    }

    const received = Math.max(0, Number(parsed.amount || 0));
    const requested = Math.max(0, Number(intent.amount || 0));
    const amountOk = isRecurringRenewal ?
      received > 0 :
      received + 0.0001 >= requested;

    if (!amountOk) {
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        status: "unmatched",
        paidAmount: received,
        providerEventIds: [...priorEvents, parsed.providerEventId],
        reconcileNote:
          `Received ₱${received.toFixed(2)}; expected ₱${requested.toFixed(2)}`,
      });
      return {
        ok: false,
        error: "AMOUNT_MISMATCH",
        intentId: intent.id,
        status: "unmatched",
      };
    }

    const checkoutPayload =
      intent.checkoutPayload && typeof intent.checkoutPayload === "object" ?
        intent.checkoutPayload :
        {};

    const subscriptionAction: SubscriptionPaymentAction = isRecurringRenewal ?
      "RENEW" :
      intent.subscriptionAction;

    const paymentDetails = {
      ...checkoutPayload,
      billingCycle: intent.billingCycle,
      paymentMethod: "gcash" as const,
      paymentReference:
        parsed.reference || intent.providerLinkId || parsed.providerEventId,
      paymentStatus: "verified" as const,
      price: isRecurringRenewal ? received : requested,
    };

    try {
      await SubscriptionService.transitionSubscription(
        businessId,
        intent.userId,
        intent.targetPlanCode,
        subscriptionAction,
        paymentDetails,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SUBSCRIPTION_FAILED";
      logger.error("subscription payment webhook apply failed", {
        businessId,
        intentId: intent.id,
        error: msg,
      });
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        status: "unmatched",
        paidAmount: received,
        providerEventIds: [...priorEvents, parsed.providerEventId],
        reconcileNote: `Subscription apply failed: ${msg}`,
      });
      return {
        ok: false,
        error: msg,
        intentId: intent.id,
        status: "unmatched",
      };
    }

    const latestSub = await db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    const subscriptionId = latestSub.empty ? undefined : latestSub.docs[0].id;

    if (isRecurringRenewal) {
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        providerEventIds: [...priorEvents, parsed.providerEventId],
        reconcileNote: `Recurring renewal applied (${parsed.providerEventId})`,
      });
    } else {
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        status: "paid",
        paidAmount: received,
        subscriptionId,
        providerEventIds: [...priorEvents, parsed.providerEventId],
      });
    }

    logger.info("subscription payment webhook reconciled", {
      businessId,
      intentId: intent.id,
      subscriptionId,
      amount: received,
      subscriptionAction,
      recurring: isRecurringRenewal,
    });

    return {
      ok: true,
      intentId: intent.id,
      status: isRecurringRenewal ? "renewed" : "paid",
    };
  }
}

async function resolveBusinessByPaymongoSubscription(
  subscriptionId: string,
): Promise<string | undefined> {
  const snap = await db
    .collectionGroup("paymongo_billing")
    .where("subscriptionId", "==", subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return undefined;
  const parent = snap.docs[0].ref.parent.parent;
  return parent?.id;
}

function extractMetadata(body: unknown): { businessId?: string } {
  if (!body || typeof body !== "object") return {};
  const root = body as Record<string, unknown>;

  if (root.businessId && typeof root.businessId === "string") {
    return { businessId: root.businessId.trim() };
  }

  const data = root.data as Record<string, unknown> | undefined;
  const attrs = data?.attributes as Record<string, unknown> | undefined;
  const inner = attrs?.data as Record<string, unknown> | undefined;
  const innerAttrs = inner?.attributes as Record<string, unknown> | undefined;
  const metadata = innerAttrs?.metadata as Record<string, string> | undefined;
  if (metadata?.businessId) {
    return { businessId: String(metadata.businessId).trim() };
  }

  const meta = root.metadata as Record<string, string> | undefined;
  if (meta?.businessId) {
    return { businessId: String(meta.businessId).trim() };
  }

  return {};
}
