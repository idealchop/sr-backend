import { describe, expect, it } from "vitest";
import { PaymongoPaymentProvider } from "../../../../services/payments/paymongo-payment-provider";

describe("PaymongoPaymentProvider.parseWebhookPayload", () => {
  const provider = new PaymongoPaymentProvider();

  it("parses payment.paid from payment links using external reference", () => {
    const parsed = provider.parseWebhookPayload({
      data: {
        id: "evt_test_1",
        attributes: {
          type: "payment.paid",
          data: {
            id: "pay_FYihALjMbcaS3UiLMqJzXLvb",
            type: "payment",
            attributes: {
              amount: 165000,
              origin: "links",
              external_reference_number: "CLmYMjQ",
              paid_at: 1780812540,
              metadata: {
                pm_reference_number: "CLmYMjQ",
              },
            },
          },
        },
      },
    });

    expect(parsed?.providerEventId).toBe("evt_test_1");
    expect(parsed?.providerReferenceNumber).toBe("CLmYMjQ");
    expect(parsed?.providerLinkId).toBeUndefined();
    expect(parsed?.providerPaymentId).toBe("pay_FYihALjMbcaS3UiLMqJzXLvb");
    expect(parsed?.intentId).toBeUndefined();
    expect(parsed?.amount).toBe(1650);
    expect(parsed?.paymentOrigin).toBe("links");
  });

  it("parses link.payment.paid with metadata intentId", () => {
    const parsed = provider.parseWebhookPayload({
      data: {
        id: "evt_test_2",
        attributes: {
          type: "link.payment.paid",
          data: {
            id: "link_abc123",
            type: "link",
            attributes: {
              amount: 165000,
              reference_number: "CLmYMjQ",
              remarks: "pi_deadbeef1234567890ab",
              metadata: {
                businessId: "biz-1",
                intentId: "pi_deadbeef1234567890ab",
                source: "subscription",
              },
            },
          },
        },
      },
    });

    expect(parsed?.providerLinkId).toBe("link_abc123");
    expect(parsed?.providerReferenceNumber).toBe("CLmYMjQ");
    expect(parsed?.intentId).toBe("pi_deadbeef1234567890ab");
    expect(parsed?.amount).toBe(1650);
  });
});
