import { describe, expect, it } from "vitest";
import { buildPortalOrderReceivedEmail } from "../../../utils/portal-order-received-email-template";

describe("buildPortalOrderReceivedEmail", () => {
  it("includes reference and track link", () => {
    const tpl = buildPortalOrderReceivedEmail({
      customerName: "Ana",
      businessName: "River Station",
      referenceId: "TX-260617-ABCD",
      trackUrl: "https://app.example/order?b=biz1&ref=TX-260617-ABCD",
    });
    expect(tpl.subject).toContain("TX-260617-ABCD");
    expect(tpl.html).toContain("Track order");
    expect(tpl.text).toContain("https://app.example/order");
    expect(tpl.brevoTag).toBe("portal_order_received");
  });
});
