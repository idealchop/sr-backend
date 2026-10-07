/* eslint-disable max-len */
/** Canonical Smart Refill email footer (privacy, social, resources). No riverph.com. */

export const SMARTREFILL_EMAIL_MARKETING_ORIGIN = "https://smartrefill.io";
export const SMARTREFILL_EMAIL_CONTACT_URL = `${SMARTREFILL_EMAIL_MARKETING_ORIGIN}/about`;
export const SMARTREFILL_EMAIL_PRIVACY_URL = `${SMARTREFILL_EMAIL_MARKETING_ORIGIN}/privacy`;
export const SMARTREFILL_EMAIL_WRS_ARTICLES_URL =
  `${SMARTREFILL_EMAIL_MARKETING_ORIGIN}/resources/blogs`;
export const SMARTREFILL_EMAIL_STORIES_URL =
  `${SMARTREFILL_EMAIL_MARKETING_ORIGIN}/resources/wrs-stories`;
export const SMARTREFILL_EMAIL_WEBINARS_URL =
  `${SMARTREFILL_EMAIL_MARKETING_ORIGIN}/resources/webinars`;
export const SMARTREFILL_EMAIL_COMMUNITY_GROUP_URL =
  "https://www.facebook.com/groups/1357335969295881";
export const SMARTREFILL_EMAIL_FACEBOOK_PAGE_URL =
  "https://www.facebook.com/smartrefillph";
export const SMARTREFILL_EMAIL_LINKEDIN_URL =
  "https://www.linkedin.com/company/smartrefill";
export const SMARTREFILL_EMAIL_CONTACT_MAILTO = "mailto:hello@smartrefill.io";
export const SMARTREFILL_EMAIL_ADDRESS =
  "410 El Grande Ave, BF Homes, Parañaque, 1720 Metro Manila";

/** 64×64 circular brand marks, inlined so email clients do not depend on a public CDN. */
export const SMARTREFILL_EMAIL_FACEBOOK_ICON_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACHUlEQVR42u1bPUvDUBQ97zamWqiC0FJ16KSDUAShc8FBcBA3J3+Cg1sFFyc/Vmf/gZPg4I9QQQd3xdp2KFZrUbFNXBzUtprW5L2Xl3u3toHec+5HHsk5QMRDyPyzTPHJ9XJdZX9UGEGAV8AqCRG6gpZFhggL8KCIEGED7jcRFGbwfuQgwgrcr24gU8APmhuZAn7QHMkk8IPkSqaB7zdnMhF8P7mTqeC9YiBEPMjk6nvBIlSAjxGwnLOwMjeE2QwhlRRwXaD+ApTqDs5v2zi6eMd12Qn8oGTJrkY6KXC4NoJ8NtbxW8IGJsdiyGdjOLtp+06ApxEIuvoHq8Ndwf+My5IjZRSkLsGZNKEw/XfT1Zou7h4cKTlZMqufm+pe+eOrFrZPXlFruhhPCKSSItCF+HUXWLLnv1vsnL6h8sl9teGi2nDV3waDCLsH3fd1B1B9DpBx3+/V2C1H3bkg8BHYWopjvWD/ek15L/nt8/zuM8qPrnkjEKqjcKQIMOnc3+8eEDIJ2FiwUVyMd3w/sdmAqoeoPAJMABPABDABTAATEHECZGpyoNmbZO4AJoAJkK/N00lJwh3ABCiSqOoipBImvxX2QgCpFCrrIKPjHaBarq5aREk6aPZVKkh5BHRxbqjSD5NO9hUV4mnSzcMjWzlOOvh2VMrmSRfzkirPAOnk4FJhmBBht8z8tyikq59PVg5smwMbJ8HWWUTYPB35+AASGeEUzxiogAAAAABJRU5ErkJggg==";
export const SMARTREFILL_EMAIL_LINKEDIN_ICON_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACRElEQVR42u1bTStEURh+zntnmjEm0RASxUKIkux8LEz5BbK0UJRkg43iD9goG7Kz0ShlZ8GCZDGyUrbDZhohn/kY7nxYKJl8jTH3nnPPOWd3z7113+c57/vec+99HkDxwey8mW94N53NdY9L3UwKArIFzJMQJipou8hgTgFuFRHMacDzTQQ5GXw+YmBOBZ6vbCBZwOcaG8kCPtcYSSbwucRKsoH/a8wkI/i/xE6ygs8WA0HxQTKvfjZYSHbwv2HSJaDC6v+ETWeAKqv/HUaXVTe6W+iEQW8vZ8cXcbRMHzjrMahcCaiQ/l9htawEikb2nL0TVGVwaYIuYrhd6Hw/nt+KYmrtBH3tZRjoKEdrjR9+r4HYzQs2Di8xtxnF6c2LdRnAu/59HgPrY81YHmpAsKkEAb8bHhehttSL0WAV9mfaUF/hs6QPCFECg12V6G0u+fZ8wO/GbH+dvD2AGPCcSGEiFEH1eBg1E2Es7ZxmXNPTWIwCN8nbBCdDESxux3D1YOLy3sTkagTR6+f38wYxVAe8chKQTKWxEj7/NHcUfciYK/RImgFndybiZurzk+QpkXHsNpicBNzHE1/Om8m0GhuhZErvBDUBXAmwU5MDwf4k6wzQBEDrBKHaV6GPPU+XgCaAk0RVFCGVzgCeQmURZHQ6A3jL1XmLKEkEzT5PBakuAVGcG7z0wySSfYWHeJpE8/DYrRwnEXw7PGXzJIp5iZdngERycPEwTDCnW2b+uygkqp/Prhi0bQ7aOAltnYXC5mnlxyurJfFub2O4ywAAAABJRU5ErkJggg==";

const LINK_COLOR = "#2563eb";
const MUTED = "#64748b";
const FAINT = "#94a3b8";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkHtml(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:${LINK_COLOR};text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}

function socialIconHtml(href: string, src: string, label: string): string {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;line-height:0;" aria-label="${escapeHtml(label)}"><img src="${src}" width="28" height="28" alt="${escapeHtml(label)}" style="display:block;border:0;outline:none;text-decoration:none;" /></a>`;
}

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: SMARTREFILL_EMAIL_PRIVACY_URL, label: "Privacy Policy" },
  { href: SMARTREFILL_EMAIL_CONTACT_URL, label: "Contact us" },
  { href: SMARTREFILL_EMAIL_WRS_ARTICLES_URL, label: "WRS articles" },
  { href: SMARTREFILL_EMAIL_STORIES_URL, label: "Stories" },
  { href: SMARTREFILL_EMAIL_WEBINARS_URL, label: "Webinars" },
  { href: SMARTREFILL_EMAIL_COMMUNITY_GROUP_URL, label: "Join community group" },
];

const DOT = `<span style="color:${FAINT};padding:0 7px;">·</span>`;

function socialIconsRowHtml(): string {
  return `
    <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 16px;">
      <tr>
        <td style="padding:0 8px;">
          ${socialIconHtml(SMARTREFILL_EMAIL_FACEBOOK_PAGE_URL, SMARTREFILL_EMAIL_FACEBOOK_ICON_SRC, "Facebook")}
        </td>
        <td style="padding:0 8px;">
          ${socialIconHtml(SMARTREFILL_EMAIL_LINKEDIN_URL, SMARTREFILL_EMAIL_LINKEDIN_ICON_SRC, "LinkedIn")}
        </td>
      </tr>
    </table>`;
}

/** Inner footer block for card / table layouts. */
export function buildSmartRefillEmailLegalFooterInnerHtml(): string {
  const year = new Date().getFullYear();
  const nav = NAV_LINKS.map((row) => linkHtml(row.href, row.label)).join(DOT);
  return `
    <p style="margin:0 0 14px;font-size:11px;line-height:1.55;color:${FAINT};text-align:center;">
      You are receiving this email because it is an important message about your Smart Refill workspace.
      You cannot unsubscribe from this type of message.
    </p>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.7;text-align:center;">
      ${nav}
    </p>
    ${socialIconsRowHtml()}
    <p style="margin:0;font-size:11px;line-height:1.5;color:${MUTED};text-align:center;">
      © ${year} Smart Refill. All rights reserved.
    </p>
    <p style="margin:6px 0 0;font-size:11px;line-height:1.5;color:${FAINT};text-align:center;">
      ${escapeHtml(SMARTREFILL_EMAIL_ADDRESS)}
    </p>`;
}

/** Table-row footer for branded transactional shells. */
export function buildSmartRefillEmailLegalFooterRowHtml(): string {
  return `
              <tr>
                <td style="padding:24px 28px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                  ${buildSmartRefillEmailLegalFooterInnerHtml()}
                </td>
              </tr>`;
}

/** Div-card footer for simpler HTML templates. */
export function buildSmartRefillEmailLegalFooterHtml(): string {
  return `
    <div style="margin:28px 0 0;padding:20px 0 0;border-top:1px solid #e2e8f0;">
      ${buildSmartRefillEmailLegalFooterInnerHtml()}
    </div>`;
}

export function buildSmartRefillEmailLegalFooterPlainText(): string {
  const year = new Date().getFullYear();
  return [
    "—",
    "Privacy Policy: " + SMARTREFILL_EMAIL_PRIVACY_URL,
    "Contact us: " + SMARTREFILL_EMAIL_CONTACT_URL,
    "WRS articles: " + SMARTREFILL_EMAIL_WRS_ARTICLES_URL,
    "Stories: " + SMARTREFILL_EMAIL_STORIES_URL,
    "Webinars: " + SMARTREFILL_EMAIL_WEBINARS_URL,
    "Join community group: " + SMARTREFILL_EMAIL_COMMUNITY_GROUP_URL,
    "Facebook: " + SMARTREFILL_EMAIL_FACEBOOK_PAGE_URL,
    "LinkedIn: " + SMARTREFILL_EMAIL_LINKEDIN_URL,
    `© ${year} Smart Refill. All rights reserved.`,
    SMARTREFILL_EMAIL_ADDRESS,
  ].join("\n");
}
