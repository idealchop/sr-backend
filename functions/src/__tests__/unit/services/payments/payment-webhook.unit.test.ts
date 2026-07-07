import { describe, expect, it } from "vitest";
import {
  buildMockWebhookSignature,
  MockPaymentProvider,
} from "../../../../services/payments/mock-payment-provider";
import { buildPaymentReconcileUpdates } from "../../../../services/payments/payment-reconcile-service";

describe("mock payment webhook signature", () => {
  it("verifies signed payload", () => {
    const body = JSON.stringify({
      eventId: "evt-1",
      intentId: "pi_abc",
      businessId: "biz-1",
      amount: 250,
    });
    const sig = buildMockWebhookSignature(body);
    const provider = new MockPaymentProvider();
    expect(provider.verifyWebhookSignature(body, sig)).toBe(true);
    expect(provider.verifyWebhookSignature(body, "bad")).toBe(false);
  });

  it("parses webhook body", () => {
    const provider = new MockPaymentProvider();
    const parsed = provider.parseWebhookPayload({
      eventId: "evt-2",
      intentId: "pi_xyz",
      amount: 100,
    });
    expect(parsed?.providerEventId).toBe("evt-2");
    expect(parsed?.intentId).toBe("pi_xyz");
    expect(parsed?.amount).toBe(100);
  });
});

describe("wrong reference still applies when amount matches open balance", () => {
  it("applies payment to transaction balance even with unfamiliar reference string", () => {
    const result = buildPaymentReconcileUpdates(
      {
        id: "tx-9",
        totalAmount: 300,
        amountPaid: 0,
        balanceDue: 300,
        paymentStatus: "unpaid",
        payments: [],
      } as never,
      300,
      { paymentId: "pay-wrong-ref", reference: "UNKNOWN-REF" },
    );
    expect(result.appliedAmount).toBe(300);
    expect(result.paymentStatus).toBe("paid");
  });
});
