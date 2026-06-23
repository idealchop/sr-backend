import { describe, expect, it } from "vitest";
import {
  buildCustomerEmailMastheadHtml,
  resolveBusinessEmailLogoUrl,
} from "../../../utils/customer-email-branding";
import { getPortalCompletionReceiptEmail } from "../../../utils/portal-completion-receipt-email-templates";
import { buildPortalOrderReceivedEmail } from "../../../utils/portal-order-received-email-template";

describe("customer-email-branding", () => {
  it("accepts https logo URLs only", () => {
    expect(resolveBusinessEmailLogoUrl("https://cdn.example/logo.png")).toBe(
      "https://cdn.example/logo.png",
    );
    expect(resolveBusinessEmailLogoUrl("ftp://bad")).toBeNull();
    expect(resolveBusinessEmailLogoUrl("")).toBeNull();
  });

  it("renders business name and logo in masthead", () => {
    const html = buildCustomerEmailMastheadHtml(
      {
        businessName: "Water ko to",
        businessLogoUrl: "https://cdn.example/logo.png",
      },
      "Order confirmation",
    );
    expect(html).toContain("Water ko to");
    expect(html).toContain("https://cdn.example/logo.png");
    expect(html).not.toContain("Smart Refill");
  });
});

describe("customer-facing email templates", () => {
  it("completion receipt uses business branding", () => {
    const tpl = getPortalCompletionReceiptEmail({
      customerName: "2 World Traders",
      businessName: "Water ko to",
      businessLogoUrl: "https://cdn.example/logo.png",
      referenceId: "TX-001",
      completedAt: "Jun 21, 2026",
      totalAmount: "500",
      amountPaid: "500",
      balanceDue: "0",
      paymentMethod: "Cash",
      paymentStatus: "paid",
    });
    expect(tpl.html).toContain("Water ko to");
    expect(tpl.html).toContain("https://cdn.example/logo.png");
    expect(tpl.html).toContain("Powered by Smart Refill");
    expect(tpl.html).toContain("River Tech Inc.");
    expect(tpl.text).toContain("Powered by Smart Refill");
  });

  it("order received email uses business branding", () => {
    const tpl = buildPortalOrderReceivedEmail({
      customerName: "Ana",
      businessName: "River Station",
      businessLogoUrl: "https://cdn.example/logo.png",
      referenceId: "TX-260617-ABCD",
      trackUrl: "https://app.example/order?b=biz1&ref=TX-260617-ABCD",
    });
    expect(tpl.subject).toContain("TX-260617-ABCD");
    expect(tpl.html).toContain("River Station");
    expect(tpl.html).toContain("Track order");
    expect(tpl.html).toContain("Powered by Smart Refill");
    expect(tpl.html).toContain("River Tech Inc.");
  });
});
