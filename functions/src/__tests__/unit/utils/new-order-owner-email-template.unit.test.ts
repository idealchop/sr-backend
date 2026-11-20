import { describe, expect, it } from "vitest";
import { buildNewOrderOwnerEmail } from "../../../utils/new-order-owner-email-template";

describe("buildNewOrderOwnerEmail", () => {
  it("emails the station for a new QR order", () => {
    const tpl = buildNewOrderOwnerEmail({
      ownerName: "Jimboy",
      businessName: "River Station",
      title: "New QR order",
      body: "Maria Santos placed a delivery order (TX-260620-ABCD).",
      referenceId: "TX-260620-ABCD",
      reviewUrl: "https://app.example/online-orders",
    });
    expect(tpl.subject).toBe("New QR order · River Station");
    expect(tpl.html).toContain("Maria Santos");
    expect(tpl.html).toContain("TX-260620-ABCD");
    expect(tpl.html).toContain("Review online orders");
    expect(tpl.text).toContain("https://app.example/online-orders");
    expect(tpl.brevoTag).toBe("new_order_owner_email");
  });
});
