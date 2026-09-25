/* eslint-disable max-len */

/** Shared Atlassian-style letter chrome for Smart Refill transactional mail. */

export const SMART_REFILL_EMAIL_LOGO_SRC =
  "https://firebasestorage.googleapis.com/v0/b/smartrefill-singapore/o/Brand%20Logo%2FAsset%2022.png?alt=media&token=f7458efe-afd7-4006-862e-40c8d524c080";

export const SMART_REFILL_BRAND_TEAL = "#44c1ba";
export const SMART_REFILL_INK = "#172b4d";
export const SMART_REFILL_SITE_URL = "https://smartrefill.io";

/** Official profiles from the public site footer — do not use guessed slugs. */
export const SMART_REFILL_SOCIAL = {
  facebook: "https://www.facebook.com/smartrefillph",
  linkedin: "https://www.linkedin.com/company/smartrefill",
  tiktok: "https://www.tiktok.com/@smartrefill",
  community: "https://www.facebook.com/groups/1357335969295881",
} as const;

export const SMART_REFILL_EMAIL_PAGES = {
  home: SMART_REFILL_SITE_URL,
  webinars: `${SMART_REFILL_SITE_URL}/resources/webinars`,
  resources: `${SMART_REFILL_SITE_URL}/resources/blogs`,
  community: SMART_REFILL_SOCIAL.community,
  privacy: `${SMART_REFILL_SITE_URL}/privacy`,
} as const;

/** Mailchimp-hosted PNGs — Google favicons render as broken file icons in Gmail. */
const SOCIAL_ICON_PNG = {
  facebook:
    "https://cdn-images.mailchimp.com/icons/social-block-v2/dark-facebook-48.png",
  linkedin:
    "https://cdn-images.mailchimp.com/icons/social-block-v2/dark-linkedin-48.png",
  tiktok:
    "https://cdn-images.mailchimp.com/icons/social-block-v2/dark-tiktok-48.png",
} as const;

export function escapeHtmlForEmail(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function smartRefillEmailCtaHtml(label: string, url: string): string {
  const urlEsc = escapeHtmlForEmail(url.trim());
  const labelEsc = escapeHtmlForEmail(label);
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;">
  <tr>
    <td align="left" style="border-radius:4px;background-color:${SMART_REFILL_BRAND_TEAL};">
      <a href="${urlEsc}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff !important;text-decoration:none;line-height:1.35;">
        ${labelEsc}
      </a>
    </td>
  </tr>
</table>`;
}

export function smartRefillEmailPasteUrlHtml(url: string): string {
  const urlEsc = escapeHtmlForEmail(url.trim());
  return `
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">
  If the button does not open, paste this link in your browser:
</p>
<p style="margin:8px 0 0;font-size:12px;line-height:1.55;color:#5e6c84;font-family:ui-monospace,Consolas,monospace;word-break:break-all;">
  ${urlEsc}
</p>`;
}

export function smartRefillEmailWhenHtml(whenLabel: string, timezone: string): string {
  return `
<p style="margin:16px 0 0;font-size:15px;line-height:1.65;color:#253858;">
  <strong style="display:block;margin:0 0 4px;font-size:13px;font-weight:600;color:#5e6c84;">When</strong>
  ${escapeHtmlForEmail(whenLabel)}
</p>
<p style="margin:4px 0 0;font-size:13px;line-height:1.55;color:#5e6c84;">
  Timezone: ${escapeHtmlForEmail(timezone)}
</p>`;
}

export function buildSmartRefillEmailFooterPlainText(): string {
  const year = new Date().getFullYear();
  return [
    "—",
    "You are receiving this email because this is an important message regarding your Smart Refill workspace. You are not allowed to unsubscribe from this type of message.",
    "",
    `Home: ${SMART_REFILL_EMAIL_PAGES.home}`,
    `Webinars: ${SMART_REFILL_EMAIL_PAGES.webinars}`,
    `Resources: ${SMART_REFILL_EMAIL_PAGES.resources}`,
    `Community: ${SMART_REFILL_EMAIL_PAGES.community}`,
    `Facebook: ${SMART_REFILL_SOCIAL.facebook}`,
    `LinkedIn: ${SMART_REFILL_SOCIAL.linkedin}`,
    `TikTok: ${SMART_REFILL_SOCIAL.tiktok}`,
    `Privacy Policy: ${SMART_REFILL_EMAIL_PAGES.privacy}`,
    "",
    "DISCLAIMER: This communication is confidential and intended strictly for the named recipient(s). If misdelivered, please notify the sender and delete this message. Personal data processed in line with the Data Privacy Act of 2012 (RA 10173).",
    "",
    `© ${year} Smart Refill. All rights reserved.`,
    "410 El Grande Ave, BF Homes, Parañaque, Metro Manila, 1720, Philippines",
  ].join("\n");
}

function footerLink(label: string, href: string): string {
  return `<a href="${escapeHtmlForEmail(href)}" target="_blank" rel="noopener noreferrer" style="color:#0052cc;text-decoration:none;font-size:13px;font-weight:500;">${escapeHtmlForEmail(label)}</a>`;
}

function socialIconHtml(
  label: string,
  href: string,
  src: string,
): string {
  const hrefEsc = escapeHtmlForEmail(href);
  const srcEsc = escapeHtmlForEmail(src);
  const alt = escapeHtmlForEmail(label);
  return `
<td align="center" style="padding:0 8px;">
  <a href="${hrefEsc}" target="_blank" rel="noopener noreferrer" title="${alt}" style="text-decoration:none;">
    <img src="${srcEsc}" width="28" height="28" alt="${alt}"
      style="display:block;border:0;width:28px;height:28px;" />
  </a>
</td>`;
}

export function buildSmartRefillEmailFooterHtml(notice?: string): string {
  const year = new Date().getFullYear();
  const noticeText =
    notice?.trim() ||
    "You are receiving this email because this is an important message regarding your Smart Refill workspace. You are not allowed to unsubscribe from this type of message.";
  const links = [
    footerLink("Home", SMART_REFILL_EMAIL_PAGES.home),
    footerLink("Webinars", SMART_REFILL_EMAIL_PAGES.webinars),
    footerLink("Resources", SMART_REFILL_EMAIL_PAGES.resources),
    footerLink("Community", SMART_REFILL_EMAIL_PAGES.community),
  ].join(
    '<span style="color:#c1c7d0;padding:0 8px;font-size:13px;">·</span>',
  );

  return `
<tr>
  <td style="padding:8px 40px 40px;">
    <hr style="border:none;border-top:1px solid #dfe1e6;margin:0 0 28px;" />
    <p style="margin:0;font-size:12px;line-height:1.6;color:#8993a4;">
      ${escapeHtmlForEmail(noticeText)}
    </p>
    <p style="margin:20px 0 0;line-height:1.9;text-align:center;">
      ${links}
    </p>
    <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:22px auto 0;">
      <tr>
        ${socialIconHtml("Facebook", SMART_REFILL_SOCIAL.facebook, SOCIAL_ICON_PNG.facebook)}
        ${socialIconHtml("LinkedIn", SMART_REFILL_SOCIAL.linkedin, SOCIAL_ICON_PNG.linkedin)}
        ${socialIconHtml("TikTok", SMART_REFILL_SOCIAL.tiktok, SOCIAL_ICON_PNG.tiktok)}
      </tr>
    </table>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8993a4;text-align:center;">
      Copyright ${year} Smart Refill. All rights reserved.
    </p>
    <p style="margin:8px 0 0;line-height:1.9;text-align:center;">
      ${footerLink("Privacy Policy", SMART_REFILL_EMAIL_PAGES.privacy)}
    </p>
    <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#8993a4;text-align:center;">
      410 El Grande Ave, BF Homes, Parañaque, Metro Manila, 1720, Philippines
    </p>
    <p style="margin:16px 0 0;font-size:11px;line-height:1.55;color:#7b8794;">
      <strong>DISCLAIMER:</strong> This communication is confidential and intended strictly for the named recipient(s). If misdelivered, please notify the sender and delete this message. Personal data processed in line with the Data Privacy Act of 2012 (RA 10173).
    </p>
  </td>
</tr>`;
}

export type SmartRefillLetterEmailInput = {
  title: string;
  headline: string;
  bodyHtml: string;
  preheader?: string;
  greetingName?: string | null;
  cta?: { label: string; url: string } | null;
  notice?: string;
  includeSignOff?: boolean;
  omitHeadline?: boolean;
};

/** White letter layout: logo, divider, headline, Hi Name, body, sign-off, footer. */
export function wrapSmartRefillLetterHtml(
  input: SmartRefillLetterEmailInput,
): string {
  const title = escapeHtmlForEmail(input.title);
  const headline = escapeHtmlForEmail(input.headline);
  const preheader = escapeHtmlForEmail(input.preheader || input.headline);
  const greeting = input.greetingName?.trim();
  const greetingHtml = greeting ?
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#172b4d;">Hi ${escapeHtmlForEmail(greeting)},</p>` :
    "";
  const ctaHtml =
    input.cta?.url ?
      smartRefillEmailCtaHtml(input.cta.label, input.cta.url) :
      "";
  const signOff =
    input.includeSignOff === false ?
      "" :
      `<p style="margin:28px 0 0;font-size:15px;line-height:1.6;color:#172b4d;">Cheers,<br />The Smart Refill team</p>`;

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <style type="text/css">
    #outlook a { padding: 0; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    @media only screen and (max-width: 620px) {
      .sr-outer { padding-left: 16px !important; padding-right: 16px !important; }
      .sr-inner { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#ffffff;">
    ${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
    <tr>
      <td align="center" class="sr-outer" style="padding:28px 16px 8px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;">
          <tr>
            <td align="center" style="padding:8px 40px 20px;">
              <img src="${SMART_REFILL_EMAIL_LOGO_SRC}" width="48" height="48" alt="Smart Refill"
                style="display:block;border:0;width:48px;height:48px;" />
              <p style="margin:10px 0 0;font-size:18px;font-weight:700;letter-spacing:0.04em;color:${SMART_REFILL_INK};">
                SMART REFILL
              </p>
            </td>
          </tr>
          <tr>
            <td class="sr-inner" style="padding:8px 40px 8px;">
              <hr style="border:none;border-top:1px solid #dfe1e6;margin:0 0 28px;" />
              ${
                input.omitHeadline ?
                  "" :
                  `<h1 style="margin:0 0 24px;font-size:22px;line-height:1.35;font-weight:700;color:${SMART_REFILL_INK};">
                ${headline}
              </h1>`
              }
              ${greetingHtml}
              <div style="font-size:15px;line-height:1.65;color:#253858;">
                ${input.bodyHtml}
              </div>
              ${ctaHtml}
              ${signOff}
            </td>
          </tr>
          ${buildSmartRefillEmailFooterHtml(input.notice)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
