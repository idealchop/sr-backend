import type { PaymentProviderId } from "./payment-intent-types";

export type ProviderLinkRequest = {
  businessId: string;
  intentId: string;
  amount: number;
  description: string;
  metadata: Record<string, string>;
  apiBaseUrl: string;
  checkoutToken: string;
};

export type ProviderLinkResult = {
  providerLinkId: string;
  checkoutUrl: string;
};

export interface PaymentProviderAdapter {
  id: PaymentProviderId;
  createPaymentLink(input: ProviderLinkRequest): Promise<ProviderLinkResult>;
  verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): boolean;
  parseWebhookPayload(body: unknown): {
    providerEventId: string;
    providerLinkId?: string;
    providerSubscriptionId?: string;
    intentId?: string;
    amount: number;
    reference?: string;
    paidAt?: string;
    eventKind?: "payment" | "subscription_invoice";
  } | null;
}
