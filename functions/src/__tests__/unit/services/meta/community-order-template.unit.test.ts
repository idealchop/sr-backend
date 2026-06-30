import { describe, expect, it } from "vitest";
import {
  COMMUNITY_ORDER_TEMPLATE_BLOCK,
  buildCommunityOrderFormMessage,
  buildCommunityOrderTemplateMessage,
  buildCommunityWelcomeMessage,
} from "../../../../services/meta/community-order-template";

describe("community-order-template", () => {
  it("includes simplified order form block", () => {
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toContain("Name:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toContain("Quantity:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("Water Station:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toContain("Water:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toContain("Address:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).toContain("Phone Number:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("delivery:");
    expect(COMMUNITY_ORDER_TEMPLATE_BLOCK).not.toContain("━━━━━━━━");
  });

  it("builds greeting with delivery location tip and form instructions", () => {
    const msg = buildCommunityWelcomeMessage();
    expect(msg).toContain("Welcome to River Smart Refill");
    expect(msg).toContain("trusted refilling stations");
    expect(msg).toContain("Tip for delivery");
    expect(msg).toContain("Here's your River Smart Refill order form");
    expect(msg).toContain("copy it, complete each line");
    expect(msg).toContain("reply CANCEL");
    expect(msg).not.toContain("Name:");
  });

  it("builds pure order form message without greeting copy", () => {
    const msg = buildCommunityOrderFormMessage();
    expect(msg).toBe(COMMUNITY_ORDER_TEMPLATE_BLOCK);
    expect(msg).not.toContain("Tip for delivery");
    expect(msg).not.toContain("Welcome to River");
    expect(msg).not.toContain("Taglish");
  });

  it("builds order postback message as pure form for embedded replies", () => {
    const msg = buildCommunityOrderTemplateMessage();
    expect(msg).toBe(COMMUNITY_ORDER_TEMPLATE_BLOCK);
    expect(msg).not.toContain("Welcome to River Smart Refill");
  });
});
