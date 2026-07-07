import { describe, expect, it } from "vitest";
import { looksLikeCommunityInquiryOrderMessage } from "../../../../services/meta/community-messenger-inquiry-service";

describe("community-messenger-inquiry-service", () => {
  it("detects filled order form in inquiry thread", () => {
    const text = [
      "Name: Ana",
      "Address: 12 Main St, Quezon City",
      "Order: 2 slim - alkaline",
    ].join("\n");
    expect(looksLikeCommunityInquiryOrderMessage(text)).toBe(true);
  });

  it("detects order line pattern without full form", () => {
    expect(looksLikeCommunityInquiryOrderMessage("3 slim - alkaline, 1 round - purified")).toBe(true);
  });

  it("does not flag casual inquiry text", () => {
    expect(looksLikeCommunityInquiryOrderMessage("Magkano ang delivery sa Malabon?")).toBe(false);
    expect(looksLikeCommunityInquiryOrderMessage("hello po")).toBe(false);
  });
});
