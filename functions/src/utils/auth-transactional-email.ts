/* eslint-disable max-len */
import { getStaffEmailVerificationEmail } from "./staff-email-verification-template";
import {
  buildSmartRefillEmailFooterPlainText,
  escapeHtmlForEmail,
  SMART_REFILL_BRAND_TEAL,
  smartRefillEmailPasteUrlHtml,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

export {
  escapeHtmlForEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./smartrefill-email-html";

const BRAND_COLOR = SMART_REFILL_BRAND_TEAL;
const PASSWORD_RESET_VALIDITY_HOURS = 1;

export interface AuthTransactionalEmailInput {
  /** Short label above the headline (e.g. "Account security") */
  eyebrow: string;
  headline: string;
  greetingName: string;
  bodyParagraphs: string[];
  ctaLabel: string;
  actionUrl: string;
  preheader: string;
  subject: string;
  /** Plain-text body lines before the action URL */
  textIntro: string;
  /** Optional rows in the detail card */
  detailRows?: Array<{ label: string; valueHtml: string }>;
  footnoteHtml?: string;
  brevoTag: string;
}

function detailCardHtml(
  rows: Array<{ label: string; valueHtml: string }>,
): string {
  const divider = "border-bottom:1px solid #e2e8f0;";
  return rows
    .map((row, i) => {
      const withDivider = i < rows.length - 1 ? divider : "";
      return `
      <tr>
        <td style="padding:14px 16px;${withDivider}">
          <table class="detail-stack" width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td class="lbl-cell" width="46%" style="width:46%;vertical-align:top;padding-right:10px;">
                <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">
                  ${row.label}
                </span>
              </td>
              <td class="val-cell" width="54%" align="right" style="width:54%;vertical-align:top;text-align:right;">
                <span style="font-size:13px;font-weight:600;line-height:1.45;word-break:break-word;color:#0f172a;">
                  ${row.valueHtml}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join("");
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** HTML + plaintext transactional email matching workspace invite quality. */
export function buildAuthTransactionalEmail(
  input: AuthTransactionalEmailInput,
): {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
} {
  const url = input.actionUrl.trim();
  const eyebrow = escapeHtmlForEmail(input.eyebrow);

  const bodyHtml =
    `<p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">${eyebrow}</p>` +
    input.bodyParagraphs
      .map(
        (p) =>
          `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#253858;">${escapeHtmlForEmail(p)}</p>`,
      )
      .join("") +
    (input.detailRows && input.detailRows.length > 0 ?
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin:8px 0 0;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              ${detailCardHtml(input.detailRows)}
            </table>
          </td>
        </tr>
      </table>` :
      "") +
    `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">${
      input.footnoteHtml ??
      "This link is time-limited. If you did not request this message, you may safely disregard it."
    }</p>` +
    smartRefillEmailPasteUrlHtml(url);

  const text =
    `Hi ${input.greetingName.trim() || "there"},\n\n` +
    `${input.textIntro}\n\n` +
    `${input.ctaLabel}:\n${url}\n\n` +
    "If you did not request this, you can ignore this email.\n\n" +
    buildSmartRefillEmailFooterPlainText();

  const html = wrapSmartRefillLetterHtml({
    title: input.headline,
    headline: input.headline,
    preheader: input.preheader,
    greetingName: input.greetingName.trim() || "there",
    bodyHtml,
    cta: { label: input.ctaLabel, url },
  });

  return {
    subject: input.subject,
    html,
    text,
    brevoTag: input.brevoTag,
  };
}

export function getPasswordResetEmail(input: {
  displayName: string;
  email: string;
  resetLink: string;
}): { subject: string; html: string; text: string; brevoTag: string } {
  const emailPlain = input.email.trim();
  const emailEsc = escapeHtmlForEmail(emailPlain);
  const mailtoHref = escapeHtmlForEmail(`mailto:${emailPlain}`);

  return buildAuthTransactionalEmail({
    eyebrow: "Account security",
    headline: "Reset your password",
    greetingName: input.displayName.trim() || "there",
    subject: "Reset your Smart Refill password",
    preheader: `Password reset requested for ${emailPlain}. Link valid ${PASSWORD_RESET_VALIDITY_HOURS} hour.`,
    textIntro:
      "We received a request to reset the password for your Smart Refill account. " +
      "Use the link below to choose a new password.",
    bodyParagraphs: [
      "We received a request to reset the password for your Smart Refill account.",
      "Select a strong password you have not used elsewhere. This link expires in one hour.",
    ],
    ctaLabel: "Choose new password",
    actionUrl: input.resetLink,
    brevoTag: "password_reset",
    detailRows: [
      {
        label: "Account email",
        valueHtml: `<a href="${mailtoHref}" style="color:#2563eb;text-decoration:none;">${emailEsc}</a>`,
      },
      {
        label: "Link validity",
        valueHtml: `<span>${PASSWORD_RESET_VALIDITY_HOURS}&nbsp;hour</span>`,
      },
    ],
    footnoteHtml:
      `This reset link remains valid for <strong style="color:#475569;">${PASSWORD_RESET_VALIDITY_HOURS}&nbsp;hour</strong>. ` +
      "If you did not request a password reset, your password will stay unchanged — you can ignore this email.",
  });
}

export type VerificationEmailAudience = "owner" | "staff";

function verificationDetailRowsHtml(
  emailEsc: string,
  mailtoHrefEsc: string,
  accountTypeEsc: string,
): string {
  const divider = "border-bottom:1px solid #e2e8f0;";
  const row = (
    label: string,
    valueInnerHtml: string,
    withDivider: boolean,
  ): string => `
      <tr>
        <td style="padding:14px 16px;${withDivider ? divider : ""}">
          <table class="detail-stack" width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td class="lbl-cell" width="46%" style="width:46%;vertical-align:top;padding-right:10px;">
                <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">
                  ${label}
                </span>
              </td>
              <td class="val-cell" width="54%" align="right" style="width:54%;vertical-align:top;text-align:right;">
                <span style="font-size:13px;font-weight:600;line-height:1.45;word-break:break-word;">
                  ${valueInnerHtml}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

  return (
    row(
      "Account email",
      `<a href="${mailtoHrefEsc}" style="color:#2563eb;font-weight:600;text-decoration:none;">${emailEsc}</a>`,
      true,
    ) +
    row(
      "Account type",
      `<span style="color:#0f172a;">${accountTypeEsc}</span>`,
      true,
    ) +
    row(
      "Confirmation",
      "<span style=\"color:#0f172a;\">One-time secure link</span>",
      false,
    )
  );
}

function verificationStepsHtml(isStaff: boolean): string {
  const steps = isStaff ?
    [
      "Confirm this email address matches your team profile.",
      "Sign in to Smart Refill with the credentials you created.",
      "Complete staff onboarding and open your assigned workspace.",
    ] :
    [
      "Confirm this email to secure your station owner account.",
      "Sign in and finish workspace setup if you have not already.",
      "Unlock your command center, suki records, and operations tools.",
    ];

  return steps
    .map(
      (step, i) => `
        <tr>
          <td style="padding:${i === 0 ? "0" : "10px"} 0 0;vertical-align:top;width:28px;">
            <span style="display:inline-block;width:22px;height:22px;border-radius:999px;background-color:${BRAND_COLOR};
              color:#ffffff;font-size:11px;font-weight:700;line-height:22px;text-align:center;">${i + 1}</span>
          </td>
          <td style="padding:${i === 0 ? "0" : "10px"} 0 0 12px;font-size:13px;line-height:1.55;color:#475569;">
            ${escapeHtmlForEmail(step)}
          </td>
        </tr>`,
    )
    .join("");
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** Station owner verification email (invite-parity layout). */
export function getOwnerEmailVerificationEmail(input: {
  displayName: string;
  email: string;
  verificationLink: string;
}): { subject: string; html: string; text: string; brevoTag: string } {
  const emailPlain = input.email.trim();
  const emailEsc = escapeHtmlForEmail(emailPlain);
  const mailtoHrefEsc = escapeHtmlForEmail(`mailto:${emailPlain}`);
  const url = input.verificationLink.trim();
  const accountTypeEsc = escapeHtmlForEmail("Station owner");

  const subject = "Verify your email — Smart Refill station account";
  const preheader =
    `Activate ${emailPlain} and unlock your Smart Refill station dashboard.`;
  const headline = "Verify your email address";
  const eyebrow = "Station account · Activation";
  const intro =
    "Welcome to Smart Refill. Confirm this email so we can activate your station owner account.";
  const cta = "Confirm email address";
  const brevoTag = "email_verification";

  const stepsPlain =
    "1. Confirm your owner email address.\n" +
    "2. Sign in and finish workspace setup.\n" +
    "3. Unlock your dashboard and operations tools.\n";

  const text =
    `Hi ${input.displayName.trim() || "there"},\n\n` +
    `${intro}\n\n` +
    "— Account details —\n" +
    `Email: ${emailPlain}\n` +
    "Type: Station owner\n\n" +
    `— What happens next —\n${stepsPlain}\n` +
    `Confirm your email:\n${url}\n\n` +
    "If you did not create a Smart Refill account, no action is required.\n\n" +
    buildSmartRefillEmailFooterPlainText();

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">
      ${escapeHtmlForEmail(eyebrow)}
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
      ${escapeHtmlForEmail(intro)}
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 16px;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          ${verificationDetailRowsHtml(emailEsc, mailtoHrefEsc, accountTypeEsc)}
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">
      What happens next
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${verificationStepsHtml(false)}
    </table>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">
      This confirmation link is single-use. If you did not create a Smart Refill account, you can ignore this email.
    </p>
    ${smartRefillEmailPasteUrlHtml(url)}
  `;

  const html = wrapSmartRefillLetterHtml({
    title: headline,
    headline,
    preheader,
    greetingName: input.displayName.trim() || "there",
    bodyHtml,
    cta: { label: cta, url },
  });

  return { subject, html: html, text, brevoTag };
}

/**
 * Routes to the dedicated staff or owner verification template.
 * @param {Object} input Template inputs.
 * @param {string} input.displayName Recipient display name.
 * @param {string} input.email Recipient email.
 * @param {string} input.verificationLink App verification URL.
 * @param {VerificationEmailAudience} [input.audience] Owner or staff audience.
 * @param {string} [input.workspaceName] Workspace name for staff emails.
 * @param {string} [input.memberRole] Member role for staff emails.
 * @return {{ subject: string, html: string, text: string, brevoTag: string }}
 */
export function getEmailVerificationEmail(input: {
  displayName: string;
  email: string;
  verificationLink: string;
  audience?: VerificationEmailAudience;
  workspaceName?: string;
  memberRole?: string;
}): { subject: string; html: string; text: string; brevoTag: string } {
  if (input.audience === "staff") {
    return getStaffEmailVerificationEmail({
      displayName: input.displayName,
      email: input.email,
      verificationLink: input.verificationLink,
      workspaceName: input.workspaceName,
      memberRole: input.memberRole,
    });
  }

  return getOwnerEmailVerificationEmail({
    displayName: input.displayName,
    email: input.email,
    verificationLink: input.verificationLink,
  });
}
