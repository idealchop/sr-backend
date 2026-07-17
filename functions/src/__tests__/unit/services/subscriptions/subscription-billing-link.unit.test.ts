import { describe, expect, it, vi, beforeEach } from "vitest";

const billingState: {
  data: Record<string, unknown> | null;
} = { data: null };

const setCalls: Array<Record<string, unknown>> = [];

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: Boolean(billingState.data),
              data: () => billingState.data || {},
            }),
            set: async (payload: Record<string, unknown>) => {
              setCalls.push(payload);
              billingState.data = {
                ...(billingState.data || {}),
                ...payload,
              };
            },
          }),
        }),
      }),
    }),
  },
  FieldValue: {
    serverTimestamp: () => "SERVER_TS",
    delete: () => "DELETE_FIELD",
  },
}));

vi.mock("../../../../services/payments/resolve-payment-provider", () => ({
  resolvePaymentProvider: () => ({ id: "mock" }),
}));

vi.mock("../../../../services/payments/paymongo-api-client", () => ({
  paymongoRecurringEnabled: () => false,
  paymongoRequest: vi.fn(),
}));

vi.mock("../../../../services/payments/paymongo-recurring-service", () => ({
  PaymongoRecurringService: {
    getBillingProfile: async () => billingState.data,
    cancelSubscription: vi.fn(),
    markBillingActive: vi.fn(),
    isEnabled: () => false,
  },
}));

const createSubscriptionIntent = vi.fn();

vi.mock("../../../../services/payments/payment-intent-service", () => ({
  PaymentIntentService: {
    createSubscriptionIntent: (...args: unknown[]) =>
      createSubscriptionIntent(...args),
  },
}));

vi.mock("../../../../services/subscriptions/subscription-effective", () => ({
  fetchRecentSubscriptionRows: async () => [
    {
      id: "sub-1",
      ref: { update: vi.fn() },
      data: {
        planCode: "grow",
        billingCycle: "monthly",
        price: 999,
        status: "active",
        paymentStatus: "verified",
        cancelAtPeriodEnd: false,
        dates: {
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        },
      },
    },
  ],
  pickEffectiveEntitling: (rows: unknown[]) => rows[0],
  isPaidBillingCycle: () => true,
  isStarterPlan: () => false,
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SubscriptionBillingService } from "../../../../services/subscriptions/subscription-billing-service";

describe("SubscriptionBillingService link session", () => {
  beforeEach(() => {
    billingState.data = null;
    setCalls.length = 0;
    createSubscriptionIntent.mockReset();
    createSubscriptionIntent.mockResolvedValue({
      id: "pi_link_1",
      checkoutUrl: "https://example.test/mock-checkout",
      provider: "mock",
      billingMode: "one_time",
      providerCustomerId: undefined,
      providerSubscriptionId: undefined,
    });
  });

  it("returns canUpdate when mock billing is linked", async () => {
    billingState.data = {
      status: "active",
      customerId: "mock_cus_abc",
      subscriptionId: "mock_sub_abc",
    };
    const profile = await SubscriptionBillingService.getProfile("biz-1");
    expect(profile.linked).toBe(true);
    expect(profile.canLink).toBe(false);
    expect(profile.canUpdate).toBe(true);
  });

  it("creates a RENEW payment intent for first-time link", async () => {
    const result = await SubscriptionBillingService.createLinkSession(
      "biz-1",
      "user-1",
      "https://api.example.test",
    );
    expect(result.checkoutUrl).toContain("mock-checkout");
    expect(createSubscriptionIntent).toHaveBeenCalledOnce();
    const arg = createSubscriptionIntent.mock.calls[0][0];
    expect(arg.subscriptionAction).toBe("RENEW");
    expect(arg.checkoutPayload.purpose).toBe("billing_link");
    expect(arg.checkoutPayload.autoRenew).toBe(true);
    expect(setCalls.length).toBeGreaterThan(0);
  });

  it("returns alreadyLinked when linked and update is false", async () => {
    billingState.data = { status: "active" };
    const result = await SubscriptionBillingService.createLinkSession(
      "biz-1",
      "user-1",
      "https://api.example.test",
    );
    expect(result.alreadyLinked).toBe(true);
    expect(createSubscriptionIntent).not.toHaveBeenCalled();
  });

  it("creates a new intent when update is true on linked account", async () => {
    billingState.data = { status: "active" };
    const result = await SubscriptionBillingService.createLinkSession(
      "biz-1",
      "user-1",
      "https://api.example.test",
      { update: true },
    );
    expect(result.alreadyLinked).toBeUndefined();
    expect(result.checkoutUrl).toBeTruthy();
    expect(createSubscriptionIntent).toHaveBeenCalledOnce();
    const arg = createSubscriptionIntent.mock.calls[0][0];
    expect(arg.checkoutPayload.billingUpdate).toBe(true);
  });
});
