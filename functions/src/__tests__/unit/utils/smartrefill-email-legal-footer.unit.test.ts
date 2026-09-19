import { describe, expect, it } from "vitest";
import {
  SMARTREFILL_EMAIL_COMMUNITY_GROUP_URL,
  SMARTREFILL_EMAIL_PRIVACY_URL,
  buildSmartRefillEmailLegalFooterHtml,
  buildSmartRefillEmailLegalFooterPlainText,
} from "../../../utils/smartrefill-email-legal-footer";
import { getPasswordResetEmail } from "../../../utils/auth-transactional-email";

describe("smartrefill email legal footer", () => {
  it("includes privacy, contact, WRS, stories, webinars, community, and socials", () => {
    const html = buildSmartRefillEmailLegalFooterHtml();
    expect(html).toContain("Privacy Policy");
    expect(html).toContain(SMARTREFILL_EMAIL_PRIVACY_URL);
    expect(html).toContain("Contact us");
    expect(html).toContain("WRS articles");
    expect(html).toContain("Stories");
    expect(html).toContain("Webinars");
    expect(html).toContain("Join community group");
    expect(html).toContain(SMARTREFILL_EMAIL_COMMUNITY_GROUP_URL);
    expect(html).toContain("alt=\"Facebook\"");
    expect(html).toContain("alt=\"LinkedIn\"");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("Facebook ·");
    expect(html).not.toContain("riverph.com");
    expect(buildSmartRefillEmailLegalFooterPlainText()).not.toContain(
      "riverph.com",
    );
  });

  it("is used by SmartRefill password-reset mail", () => {
    const tpl = getPasswordResetEmail({
      displayName: "Justfer",
      email: "owner@example.com",
      resetLink: "https://smartrefill.io/reset-password?oobCode=sample",
    });
    expect(tpl.html).toContain("Privacy Policy");
    expect(tpl.html).not.toContain("riverph.com");
  });
});
