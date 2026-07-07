import { describe, expect, it } from "vitest";
import {
  buildCommunityClarificationMessage,
  buildCommunityOrderReceivedMessage,
} from "../../../../services/meta/community-order-reply-service";
import { isCasualMessengerGreeting } from "../../../../services/meta/community-order-template";

describe("community-order-reply-service", () => {
  it("lists missing fields without embedding the order form", () => {
    const msg = buildCommunityClarificationMessage(["order", "location"], {
      name: "Ana",
    });
    expect(msg).toContain("Kulang pa ang mga field na ito:");
    expect(msg).toContain("Order (hal. 3 slim - alkaline)");
    expect(msg).toContain("Address");
    expect(msg).toContain("Konti na lang!");
    expect(msg).toContain("Paki-send ang kulang");
    expect(msg).not.toContain("Name:\nAddress:");
    expect(msg).not.toContain("copy and resend the form");
  });

  it("builds confirmation with captured summary and reference", () => {
    const msg = buildCommunityOrderReceivedMessage(
      {
        name: "Maria",
        delivery: true,
        qty: 7,
        number: "09171234567",
        location: "Malabon",
        orderLines: [
          { qty: 3, container: "slim", waterType: "alkaline" },
          { qty: 4, container: "round", waterType: "purified" },
        ],
      },
      "CR-ABC12345",
    );
    expect(msg).toContain("Reference: CR-ABC12345");
    expect(msg).toContain("natanggap na ang order mo");
    expect(msg).toContain("Maria");
    expect(msg).toContain("3 slim - alkaline, 4 round - purified");
    expect(msg).toContain("Total: 7 container(s)");
    expect(msg).toContain("Presyo:");
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
