import { describe, expect, it } from "vitest";
import {
  buildCommunityClarificationMessage,
  buildCommunityOrderReceivedMessage,
} from "../../../../services/meta/community-order-reply-service";
import { isCasualMessengerGreeting } from "../../../../services/meta/community-order-template";

describe("community-order-reply-service", () => {
  it("lists missing fields in clarification message", () => {
    const msg = buildCommunityClarificationMessage(["number", "location"], {
      name: "Ana",
      qty: 2,
    });
    expect(msg).toContain("Phone Number");
    expect(msg).toContain("Address");
    expect(msg).toContain("almost ready");
    expect(msg).toContain("Name:");
  });

  it("builds confirmation with captured summary and reference", () => {
    const msg = buildCommunityOrderReceivedMessage(
      {
        name: "Maria",
        delivery: true,
        qty: 5,
        number: "09171234567",
        location: "Malabon",
        preferredWaterType: "alkaline",
      },
      "CR-ABC12345",
    );
    expect(msg).toContain("Reference: CR-ABC12345");
    expect(msg).toContain("order has been received");
    expect(msg).toContain("Maria");
    expect(msg).toContain("Delivery: 5 gal");
    expect(msg).toContain("alkaline");
  });
});

describe("isCasualMessengerGreeting", () => {
  it("detects common greetings", () => {
    expect(isCasualMessengerGreeting("hello")).toBe(true);
    expect(isCasualMessengerGreeting("Salamat")).toBe(true);
    expect(isCasualMessengerGreeting("order")).toBe(true);
  });

  it("does not treat template text as greeting", () => {
    expect(isCasualMessengerGreeting("name: Juan")).toBe(false);
  });
});
