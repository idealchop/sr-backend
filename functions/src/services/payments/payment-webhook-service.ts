import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { reEnableAutoRenewOnCurrentPlan, syncAutoRenewAfterSubscriptionPayment } from "../subscriptions/subscription-auto-renew-sync";
import { SubscriptionBillingService } from "../subscriptions/subscription-billing-service";
import { PaymentIntentService } from "./payment-intent-service";
import type {
  PaymentIntentRecord,
  PaymentProviderId,
  SubscriptionPaymentAction,
} from "./payment-intent-types";
import { getPaymongoLinkByReference, getPaymongoPaymentReference } from "./paymongo-api-client";
import type { ParsedPaymentWebhook } from "./payment-provider-types";
import { PaymongoRecurringService } from "./paymongo-recurring-service";
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
    const resolved = await resolveSubscriptionPaymentIntent(
      input.provider,
      parsed,
      metadata.businessId,
    );
    let businessId = resolved.businessId;
    let intent = resolved.intent;

    if (!businessId && parsed.providerSubscriptionId) {
      businessId = await resolveBusinessByPaymongoSubscription(
        parsed.providerSubscriptionId,
      );
    }

    if (!businessId && intent) {
      businessId = intent.businessId;
    }

    if (!businessId) {
      return { ok: false, error: "MISSING_BUSINESS" };
    }

    if (!intent && parsed.intentId) {
      intent = await PaymentIntentService.getIntent(businessId, parsed.intentId);
    }

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

    if (!intent && parsed.providerSubscriptionId && businessId) {
      if (parsed.eventKind === "subscription_invoice") {
        await PaymongoRecurringService.markBillingActive(businessId);
        const billingSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("paymongo_billing")
          .doc("default")
          .get();
        const linkPurpose = String(billingSnap.data()?.linkPurpose || "");
        if (linkPurpose === "billing_setup") {
          await billingSnap.ref.update({
            linkPurpose: FieldValue.delete(),
            status: "active",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        logger.info("subscription billing linked via invoice webhook", {
          businessId,
          providerSubscriptionId: parsed.providerSubscriptionId,
        });
        await reEnableAutoRenewOnCurrentPlan(businessId);
        return {
          ok: true,
          status: "billing_linked",
        };
      }
    }

    if (!intent) {
      logger.warn("payment webhook unmatched intent", {
        businessId,
        providerEventId: parsed.providerEventId,
        providerReferenceNumber: parsed.providerReferenceNumber,
        paymentOrigin: parsed.paymentOrigin,
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

    const isBillingLinkOnly =
      String(checkoutPayload.purpose || "") === "billing_link";

    if (isBillingLinkOnly) {
      await SubscriptionBillingService.completeBillingLinkSetup(
        businessId,
        intent.id,
        input.provider,
      );
      await reEnableAutoRenewOnCurrentPlan(businessId);
      await PaymentIntentService.patchIntent(businessId, intent.id, {
        status: "paid",
        paidAmount: received,
        providerEventIds: [...priorEvents, parsed.providerEventId],
        reconcileNote: "Billing account linked",
      });
      logger.info("subscription billing linked via payment intent", {
        businessId,
        intentId: intent.id,
      });
      return {
        ok: true,
        intentId: intent.id,
        status: "billing_linked",
      };
    }

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
      await syncAutoRenewAfterSubscriptionPayment(
        businessId,
        intent,
        checkoutPayload,
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

async function resolveSubscriptionPaymentIntent(
  provider: PaymentProviderId,
  parsed: ParsedPaymentWebhook,
  metadataBusinessId?: string,
): Promise<{ businessId?: string; intent: PaymentIntentRecord | null }> {
  let businessId = metadataBusinessId;
  let intent: PaymentIntentRecord | null = null;
  let referenceNumber = parsed.providerReferenceNumber;

  if (!intent && parsed.providerLinkId) {
    intent = await PaymentIntentService.findByProviderLinkIdGlobal(
      parsed.providerLinkId,
    );
    if (intent) businessId = intent.businessId;
  }

  if (!intent && parsed.intentId && businessId) {
    intent = await PaymentIntentService.getIntent(businessId, parsed.intentId);
  }

  if (!intent && referenceNumber) {
    intent = await PaymentIntentService.findByProviderReferenceNumber(
      referenceNumber,
    );
    if (intent) businessId = intent.businessId;
  }

  if (!intent && provider === "paymongo") {
    if (!referenceNumber && parsed.providerPaymentId) {
      try {
        referenceNumber = await getPaymongoPaymentReference(
          parsed.providerPaymentId,
        );
      } catch (err) {
        logger.warn("PayMongo payment lookup failed", {
          paymentId: parsed.providerPaymentId,
          err: err instanceof Error ? err.message : err,
        });
      }
    }

    if (referenceNumber) {
      try {
        const link = await getPaymongoLinkByReference(referenceNumber);
        if (link?.businessId) businessId = link.businessId;
        if (link?.intentId && businessId) {
          intent = await PaymentIntentService.getIntent(businessId, link.intentId);
        }
        if (!intent && link?.linkId) {
          intent = await PaymentIntentService.findByProviderLinkIdGlobal(
            link.linkId,
          );
          if (intent) businessId = intent.businessId;
        }
      } catch (err) {
        logger.warn("PayMongo link lookup by reference failed", {
          reference: referenceNumber,
          err: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  return { businessId, intent };
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
