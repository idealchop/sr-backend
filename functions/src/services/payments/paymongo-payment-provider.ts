import crypto from "crypto";
import { logger } from "../observability/logging/logger";
import type { PaymentProviderAdapter } from "./payment-provider-types";

function paymongoSecretKey(): string | undefined {
  const key = process.env.PAYMONGO_SECRET_KEY?.trim();
  return key || undefined;
}

function amountToCentavos(amount: number): number {
  return Math.round(amount * 100);
}

export class PaymongoPaymentProvider implements PaymentProviderAdapter {
  id = "paymongo" as const;

  async createPaymentLink(
    input: import("./payment-provider-types").ProviderLinkRequest,
  ): Promise<import("./payment-provider-types").ProviderLinkResult> {
    const secret = paymongoSecretKey();
    if (!secret) {
      throw new Error("PAYMONGO_NOT_CONFIGURED");
    }

    const auth = Buffer.from(`${secret}:`).toString("base64");
    const res = await fetch("https://api.paymongo.com/v1/links", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amountToCentavos(input.amount),
            description: input.description.slice(0, 200),
            remarks: input.intentId,
            metadata: input.metadata,
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.error("PayMongo link create failed", {
        status: res.status,
        errText: errText.slice(0, 500),
      });
      throw new Error("PAYMONGO_LINK_FAILED");
    }

    const json = (await res.json()) as {
      data?: {
        id?: string;
        attributes?: { checkout_url?: string; reference_number?: string };
      };
    };
    const providerLinkId = String(json.data?.id || "").trim();
    const checkoutUrl = String(json.data?.attributes?.checkout_url || "").trim();
    if (!providerLinkId || !checkoutUrl) {
      throw new Error("PAYMONGO_LINK_INVALID");
    }
    return { providerLinkId, checkoutUrl };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): boolean {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET?.trim();
    if (!secret || !signatureHeader) return false;

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const parts = signatureHeader.split(",").reduce<Record<string, string>>(
      (acc, part) => {
        const [k, v] = part.split("=");
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      },
      {},
    );
    const timestamp = parts.t;
    const testSig = parts.te;
    const liveSig = parts.li;
    const signature = testSig || liveSig;
    if (!timestamp || !signature) return false;

    const payload = `${timestamp}.${body}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  parseWebhookPayload(body: unknown): {
    providerEventId: string;
    providerLinkId?: string;
    providerSubscriptionId?: string;
    intentId?: string;
    amount: number;
    reference?: string;
    paidAt?: string;
    eventKind?: "payment" | "subscription_invoice";
  } | null {
    if (!body || typeof body !== "object") return null;
    const root = body as {
      data?: {
        id?: string;
        attributes?: {
          type?: string;
          data?: {
            id?: string;
            type?: string;
            attributes?: {
              amount?: number;
              paid_at?: number;
              remarks?: string;
              metadata?: Record<string, string>;
              resource_id?: string;
              status?: string;
            };
          };
        };
      };
    };

    const eventId = String(root.data?.id || "").trim();
    const eventType = String(root.data?.attributes?.type || "").trim();
    if (!eventId || !eventType) return null;

    const inner = root.data?.attributes?.data;
    const attrs = inner?.attributes;
    const amountCentavos = Number(attrs?.amount ?? 0);
    const amount = amountCentavos > 0 ? amountCentavos / 100 : 0;

    if (eventType === "subscription.invoice.paid") {
      const providerSubscriptionId =
        String(attrs?.resource_id || "").trim() || undefined;
      if (!providerSubscriptionId || !amount) return null;
      return {
        providerEventId: eventId,
        providerSubscriptionId,
        providerLinkId: String(inner?.id || "").trim() || undefined,
        amount,
        reference: providerSubscriptionId,
        eventKind: "subscription_invoice",
      };
    }

    if (!eventType.includes("payment")) return null;

    const intentId =
      String(attrs?.metadata?.intentId || attrs?.remarks || "").trim() ||
      undefined;
    const providerLinkId = String(inner?.id || "").trim() || undefined;
    const paidAt =
      attrs?.paid_at ?
        new Date(attrs.paid_at * 1000).toISOString() :
        undefined;

    if (!amount) return null;

    return {
      providerEventId: eventId,
      providerLinkId,
      intentId,
      amount,
      reference: providerLinkId,
      paidAt,
      eventKind: "payment",
    };
  }
}
