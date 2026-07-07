import { describe, expect, it } from "vitest";
import {
  COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK,
  COMMUNITY_ORDER_TEMPLATE_BLOCK,
  buildCommunityOrderFormExampleMessage,
  buildCommunityOrderFormMessage,
  buildCommunityOrderTemplateMessage,
  buildCommunityWaterDeliveryIntroMessage,
  buildCommunityWelcomeGreeting,
  buildCommunityWelcomeMessage,
} from "../../../../services/meta/community-order-template";

describe("community-order-template", () => {
  it("includes blank order form block with simple labels", () => {
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toBe(`Name:
Address:
Email:
Number:
Order:`);
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("(Required)");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("(optional)");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("Quantity:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("Phone Number:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("delivery:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("━━━━━━━━");
  });

  it("example block nudges container and water choices with multi-item order", () => {
    expect(COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK).toContain("John Doe");
    expect(COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK).toContain("3 slim - alkaline");
    expect(COMMUNITY_ORDER_FORM_EXAMPLE_BLOCK).toContain("4 round - purified");
  });

  it("builds new-user greeting headline", () => {
    const msg = buildCommunityWelcomeGreeting({ isReturningUser: false });
    expect(msg).toBe(
      "Welcome to River Smart Refill ✨\n\nPure water, delivered with care — connecting you with trusted refilling stations in your community.",
    );
  });

  it("builds returning-user greeting headline", () => {
    const msg = buildCommunityWelcomeGreeting({ isReturningUser: true });
    expect(msg).toBe(
      "Welcome Back to River Smart Refill ✨\n\nPure water, delivered with care — connecting you with trusted refilling stations in your community.",
    );
  });

  it("builds short welcome before service selection", () => {
    const msg = buildCommunityWelcomeMessage();
    expect(msg).toContain("Welcome to River Smart Refill");
    expect(msg).not.toContain("Welcome Back");
    expect(msg).toContain("trusted refilling stations");
    expect(msg).not.toContain("Tip for delivery");
    expect(msg).not.toContain("order form");
    expect(msg).not.toContain("CANCEL");
  });

  it("builds returning-user full welcome with welcome-back headline", () => {
    const msg = buildCommunityWelcomeMessage({ isReturningUser: true });
    expect(msg).toContain("Welcome Back to River Smart Refill");
    expect(msg).toContain("good to see you again");
    expect(msg).not.toContain("we're glad you're here");
  });

  it("builds water delivery intro without step-by-step or cancel hint", () => {
    const msg = buildCommunityWaterDeliveryIntroMessage();
    expect(msg).toContain("Ito ang order form ng River Smart Refill.");
    expect(msg).toContain("I-copy mo, punan ang bawat line");
    expect(msg).not.toContain("Step-by-step");
    expect(msg).not.toContain("CANCEL");
  });

  it("builds pure order form message without greeting copy", () => {
    const msg = buildCommunityOrderFormMessage();
    expect(msg).toBe(COMMUNITY_ORDER_TEMPLATE_BLOCK);
    expect(msg).not.toContain("Tip for delivery");
    expect(msg).not.toContain("Welcome to River");
  });

  it("builds example message with tips for container and water type", () => {
    const msg = buildCommunityOrderFormExampleMessage();
    expect(msg).toContain("Example:");
    expect(msg).toContain("3 slim - alkaline, 4 round - purified");
    expect(msg).toContain("round o slim");
    expect(msg).toContain("alkaline, mineral, o purified");
    expect(msg).toContain("Paghiwalayin ng comma");
    expect(msg).toContain("optional lang");
    expect(msg).toContain("Ready ka na?");
  });

  it("builds order postback message as pure form for embedded replies", () => {
    const msg = buildCommunityOrderTemplateMessage();
    expect(msg).toBe(COMMUNITY_ORDER_TEMPLATE_BLOCK);
    expect(msg).not.toContain("Welcome to River Smart Refill");
  });
});
