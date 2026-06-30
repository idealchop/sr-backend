import { describe, expect, it } from "vitest";
import { buildCommunityOrderConfirmSummary } from "../../../../services/meta/community-order-reply-service";
import {
  META_POSTBACK_ORDER_CONFIRM_YES,
  META_POSTBACK_WIZARD_DELIVERY_YES,
  META_POSTBACK_WIZARD_START,
} from "../../../../services/meta/community-order-template";

describe("community-order-wizard constants", () => {
  it("uses stable postback payloads", () => {
    expect(META_POSTBACK_WIZARD_START).toBe("WIZARD_START");
    expect(META_POSTBACK_WIZARD_DELIVERY_YES).toBe("WIZARD_DELIVERY_YES");
    expect(META_POSTBACK_ORDER_CONFIRM_YES).toBe("ORDER_CONFIRM_YES");
  });
});

describe("buildCommunityOrderConfirmSummary", () => {
  it("summarizes delivery orders for CP-29 confirm", () => {
    const summary = buildCommunityOrderConfirmSummary({
      name: "Ana",
      delivery: true,
      qty: 5,
      number: "09171234567",
      location: "Quezon City",
    });

    expect(summary).toContain("Ana");
    expect(summary).toContain("Delivery");
    expect(summary).toContain("5 gal");
    expect(summary).toContain("09171234567");
    expect(summary).toContain("Quezon City");
    expect(summary).toContain("Confirm order");
  });

  it("summarizes pickup orders", () => {
    const summary = buildCommunityOrderConfirmSummary({
      name: "Ben",
      delivery: false,
      qty: 2,
      number: "09181234567",
    });

    expect(summary).toContain("Pickup");
    expect(summary).not.toContain("Address:");
  });
});
