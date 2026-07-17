export type PaymentProviderId = "mock" | "paymongo";

export type PaymentIntentStatus =
  | "pending"
  | "paid"
  | "partial"
  | "overpaid"
  | "unmatched"
  | "expired"
  | "cancelled";

export type PaymentIntentSource =
  | "subscription"
  | "resource_video"
  | "resource_webinar"
  | "resource_blog";

export type SubscriptionPaymentAction = "RENEW" | "UPGRADE" | "DOWNGRADE";

export type SubscriptionBillingMode = "one_time" | "recurring" | "recurring_link";

export interface PaymentIntentRecord {
  id: string;
  businessId: string;
  userId: string;
  targetPlanCode: string;
  subscriptionAction: SubscriptionPaymentAction;
  billingCycle: "monthly" | "yearly";
  billingMode?: SubscriptionBillingMode;
  amount: number;
  currency: "PHP";
  provider: PaymentProviderId;
  providerLinkId?: string;
  providerReferenceNumber?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  checkoutUrl: string;
  checkoutToken: string;
  status: PaymentIntentStatus;
  paidAmount?: number;
  providerEventIds?: string[];
  reconcileNote?: string;
  checkoutPayload?: Record<string, unknown>;
  subscriptionId?: string;
  source: PaymentIntentSource;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type CreateSubscriptionPaymentIntentInput = {
  businessId: string;
  userId: string;
  targetPlanCode: string;
  subscriptionAction: SubscriptionPaymentAction;
  billingCycle: "monthly" | "yearly";
  billingMode?: SubscriptionBillingMode;
  amount: number;
  checkoutPayload?: Record<string, unknown>;
  ownerEmail?: string;
  ownerName?: string;
  apiBaseUrl: string;
};

export type CreateResourceVideoUnlockIntentInput = {
  businessId: string;
  userId: string;
  videoId: string;
  videoName: string;
  amount: number;
  apiBaseUrl: string;
};

export type CreateResourceWebinarUnlockIntentInput = {
  businessId: string;
  userId: string;
  eventId: string;
  eventName: string;
  amount: number;
  apiBaseUrl: string;
};

export type CreateResourceBlogUnlockIntentInput = {
  businessId: string;
  userId: string;
  articleId: string;
  articleTitle: string;
  amount: number;
  apiBaseUrl: string;
};

export type PaymentWebhookPayload = {
  provider: PaymentProviderId;
  providerEventId: string;
  providerLinkId?: string;
  intentId?: string;
  amount: number;
  currency?: string;
  reference?: string;
  paidAt?: string;
};
