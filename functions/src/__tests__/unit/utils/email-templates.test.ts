import { describe, it, expect } from "vitest";
import { getSmartRefillVerificationTemplate } from "../../../utils/email-templates";

describe("Email Templates", () => {
  it("should generate a verification template with the correct username and link", () => {
    const username = "Test User";
    const link = "https://example.com/verify";
    const template = getSmartRefillVerificationTemplate(username, link);

    expect(template.subject).toContain("Smart Refill");
    expect(template.html).toContain(username);
    expect(template.html).toContain(link);
  });
});
