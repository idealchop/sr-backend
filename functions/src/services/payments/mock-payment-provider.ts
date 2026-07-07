import crypto from "crypto";
import type { PaymentProviderAdapter } from "./payment-provider-types";

const MOCK_WEBHOOK_SECRET =
  process.env.PAYMENT_MOCK_WEBHOOK_SECRET || "smartrefill-mock-payment-dev";

export class MockPaymentProvider implements PaymentProviderAdapter {
  id = "mock" as const;

  async createPaymentLink(
    input: import("./payment-provider-types").ProviderLinkRequest,
  ): Promise<import("./payment-provider-types").ProviderLinkResult> {
    const base = input.apiBaseUrl.replace(/\/$/, "");
    const checkoutUrl =
      `${base}/public/payments/mock-checkout/${input.intentId}` +
      `?b=${encodeURIComponent(input.businessId)}` +
      `&token=${encodeURIComponent(input.checkoutToken)}`;
    return {
      providerLinkId: `mock_${input.intentId}`,
      checkoutUrl,
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): boolean {
    if (!signatureHeader) return false;
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = crypto
      .createHmac("sha256", MOCK_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");
    const received = signatureHeader.trim();
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
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
    const root = body as Record<string, unknown>;
    const eventId = String(root.eventId || root.providerEventId || "").trim();
    const intentId = String(root.intentId || "").trim();
    const amount = Number(root.amount);
    if (!eventId || !intentId || !Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return {
      providerEventId: eventId,
      providerLinkId: String(root.providerLinkId || `mock_${intentId}`),
      intentId,
      amount,
      reference: typeof root.reference === "string" ? root.reference : undefined,
      paidAt: typeof root.paidAt === "string" ? root.paidAt : undefined,
    };
  }
}

export function buildMockWebhookSignature(body: string): string {
  return crypto
    .createHmac("sha256", MOCK_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
}
