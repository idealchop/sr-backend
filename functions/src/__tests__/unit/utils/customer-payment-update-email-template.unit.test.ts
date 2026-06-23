import { describe, expect, it } from "vitest";
import { buildCustomerPaymentUpdateEmail } from "../../../utils/customer-payment-update-email-template";

describe("buildCustomerPaymentUpdateEmail", () => {
  it("includes payment breakdown and track link", () => {
    const tpl = buildCustomerPaymentUpdateEmail({
      customerName: "Ana",
      businessName: "Water ko to",
      businessLogoUrl: "https://cdn.example/logo.png",
      referenceId: "TX-260617-ABCD",
      trackUrl: "https://app.example/order?b=biz1&ref=TX-260617-ABCD",
      statusLabel: "Partial payment received",
      totalAmount: "₱1,000.00",
      amountPaid: "₱400.00",
      balanceDue: "₱600.00",
      detailLine: "Nakatanggap kami ng partial payment.",
    });
    expect(tpl.subject).toContain("Partial payment received");
    expect(tpl.html).toContain("₱400.00");
    expect(tpl.html).toContain("Water ko to");
    expect(tpl.html).toContain("Track order");
    expect(tpl.brevoTag).toBe("customer_payment_update");
  });
});
