import { describe, expect, it } from "vitest";
import { getPasswordResetEmail } from "../../../utils/auth-transactional-email";
import { getTeamWorkspaceInviteEmail } from "../../../utils/email-templates";
import { buildGuestWebinarInviteEmail } from "../../../utils/guest-webinar-invite-email-template";
import {
  SMART_REFILL_EMAIL_LOGO_SRC,
  SMART_REFILL_EMAIL_PAGES,
  SMART_REFILL_SOCIAL,
  wrapSmartRefillLetterHtml,
} from "../../../utils/smartrefill-email-html";

describe("smartrefill letter email chrome", () => {
  it("renders a flat letter with Home/Webinars/Resources/Community and working social PNGs", () => {
    const html = wrapSmartRefillLetterHtml({
      title: "Test",
      headline: "Your subscription needs attention",
      greetingName: "Jimboy",
      bodyHtml: "<p>We noticed an extended period of inactivity.</p>",
      cta: { label: "Contact us", url: "mailto:support@smartrefill.io" },
    });

    expect(html).toContain(SMART_REFILL_EMAIL_LOGO_SRC);
    expect(html).toContain("SMART REFILL");
    expect(html).toContain("Hi Jimboy,");
    expect(html).toContain("Cheers,");
    expect(html).toContain("The Smart Refill team");
    expect(html).toContain(">Home<");
    expect(html).toContain(">Webinars<");
    expect(html).toContain(">Resources<");
    expect(html).toContain(">Community<");
    expect(html).toContain(SMART_REFILL_EMAIL_PAGES.home);
    expect(html).toContain(SMART_REFILL_EMAIL_PAGES.webinars);
    expect(html).toContain(SMART_REFILL_EMAIL_PAGES.resources);
    expect(html).toContain(SMART_REFILL_EMAIL_PAGES.community);
    expect(html).toContain(SMART_REFILL_EMAIL_PAGES.privacy);
    expect(html).toContain("DISCLAIMER");
    expect(html).toContain("Data Privacy Act of 2012");
    expect(html).toContain(SMART_REFILL_SOCIAL.facebook);
    expect(html).toContain(SMART_REFILL_SOCIAL.linkedin);
    expect(html).toContain(SMART_REFILL_SOCIAL.tiktok);
    expect(html).toContain('alt="Facebook"');
    expect(html).toContain('alt="LinkedIn"');
    expect(html).toContain('alt="TikTok"');
    expect(html).toContain("cdn-images.mailchimp.com/icons/social-block-v2/dark-facebook-48.png");
    expect(html).toContain("cdn-images.mailchimp.com/icons/social-block-v2/dark-linkedin-48.png");
    expect(html).toContain("cdn-images.mailchimp.com/icons/social-block-v2/dark-tiktok-48.png");
    expect(html).not.toContain("google.com/s2/favicons");
    expect(html).not.toContain(".svg");
    expect(html).not.toContain("facebook.com/groups/smartrefill\"");
    expect(html).not.toContain("facebook.com/smartrefill\"");
  });

  it("uses the letter chrome for password reset and workspace invite", () => {
    const reset = getPasswordResetEmail({
      displayName: "Maria",
      email: "owner@station.ph",
      resetLink: "https://app.smartrefill.io/reset?token=abc",
    });
    expect(reset.html).toContain("Hi Maria,");
    expect(reset.html).toContain(SMART_REFILL_SOCIAL.facebook);
    expect(reset.html).toContain(SMART_REFILL_EMAIL_LOGO_SRC);

    const invite = getTeamWorkspaceInviteEmail({
      acceptInviteUrl: "https://app.smartrefill.io/invite/abc",
      inviterName: "Ana",
      inviteeDisplayName: "Juan",
      inviteeEmail: "juan@station.ph",
      organizationName: "River Station",
      roleKey: "rider",
      validityDays: 7,
    });
    expect(invite.html).toContain("Hi Juan,");
    expect(invite.html).toContain("Workspace invitation");
    expect(invite.html).toContain(SMART_REFILL_EMAIL_PAGES.webinars);
  });

  it("keeps webinar invite details as plain text instead of a card", () => {
    const tpl = buildGuestWebinarInviteEmail({
      displayName: "Jimboy",
      eventName: "Water Chemistry 101",
      startsAtLabel: "Sunday, September 27, 2026, 2:00 PM",
      timezone: "Asia/Manila",
      joinUrl: "https://smartrefill.io/resources/webinars/join?t=abc",
      cancelUrl: "https://smartrefill.io/resources/webinars/cancel?t=abc",
      requiresApproval: false,
    });
    expect(tpl.html).toContain("Sunday, September 27, 2026, 2:00 PM");
    expect(tpl.html).toContain("Timezone: Asia/Manila");
    expect(tpl.html).not.toContain("background:#f4f5f7");
    expect(tpl.html).not.toContain("border:1px solid #dfe1e6;");
    expect(tpl.html).toContain(SMART_REFILL_EMAIL_PAGES.community);
  });
});
