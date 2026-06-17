/* eslint-disable max-len */
import { getStaffEmailVerificationEmail } from "./staff-email-verification-template";

/** Shared masthead + layout for account security emails (verify, reset password). */

export const SMART_REFILL_EMAIL_LOGO_SRC =
  "https://firebasestorage.googleapis.com/v0/b/smartrefill-singapore/o/Brand%20Logo%2FAsset%2022.png?alt=media&token=f7458efe-afd7-4006-862e-40c8d524c080";

const BRAND_COLOR = "#44c1ba";
const PASSWORD_RESET_VALIDITY_HOURS = 1;

export function escapeHtmlForEmail(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  const year = new Date().getFullYear();
  const name = escapeHtmlForEmail(input.greetingName.trim() || "there");
  const url = input.actionUrl.trim();
  const urlEsc = escapeHtmlForEmail(url);
  const eyebrow = escapeHtmlForEmail(input.eyebrow);
  const headline = escapeHtmlForEmail(input.headline);
  const preheader = escapeHtmlForEmail(input.preheader);
  const cta = escapeHtmlForEmail(input.ctaLabel);

  const bodyHtml = input.bodyParagraphs
    .map(
      (p) =>
        `<p style="margin:14px 0 0;font-size:14px;line-height:1.68;color:#475569;">${escapeHtmlForEmail(p)}</p>`,
    )
    .join("");

  const detailBlock =
    input.detailRows && input.detailRows.length > 0 ?
      `
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:26px 0 0;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
                    <tr>
                      <td style="padding:0;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          ${detailCardHtml(input.detailRows)}
                        </table>
                      </td>
                    </tr>
                  </table>` :
      "";

  const footnote =
    input.footnoteHtml ??
    "This link is time-limited. If you did not request this message, you may safely disregard it.";

  const text =
    `${input.greetingName.trim() ? `${input.greetingName.trim()},` : "Good day,"}\n\n` +
    `${input.textIntro}\n\n` +
    `${input.ctaLabel}:\n${url}\n\n` +
    "If you did not request this, you can ignore this email.\n\n" +
    `—\nSmart Refill\nRiver PH · https://riverph.com/\n© ${year} · All rights reserved`;

  const html = `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="x-apple-disable-message-reformatting" />
          <title>${headline}</title>
          <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
          <style type="text/css">
              #outlook a { padding: 0; }
              body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
              @media only screen and (max-width: 620px) {
                .outer-pad { padding-left: 16px !important; padding-right: 16px !important; }
                .content-pad { padding: 24px 20px !important; }
                .detail-stack td { display: block !important; width: 100% !important; text-align: left !important; }
              }
          </style>
      </head>
      <body style="margin:0;padding:0;background-color:#e8eef4;font-family:'Manrope','Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#e8eef4;">
        ${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e8eef4;">
        <tr>
          <td align="center" class="outer-pad" style="padding:28px 14px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="max-width:600px;background-color:#ffffff;border:1px solid #d8e2ec;border-radius:14px;
                overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
              <tr>
                <td style="padding:0;border-bottom:3px solid ${BRAND_COLOR};background-color:#fbfcfd;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="padding:24px 28px 20px;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="vertical-align:middle;padding-right:14px;">
                              <img src="${SMART_REFILL_EMAIL_LOGO_SRC}" width="44" height="44"
                                alt="Smart Refill" style="display:block;border-radius:10px;" />
                            </td>
                            <td style="vertical-align:middle;">
                              <p style="margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
                                Smart&nbsp;Refill
                              </p>
                              <p style="margin:6px 0 0;font-size:10px;font-weight:600;letter-spacing:0.14em;
                                text-transform:uppercase;color:#64748b;">
                                Your operating system for business essentials.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="content-pad" style="padding:32px 32px 28px;">
                  <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">
                    ${eyebrow}
                  </p>
                  <h1 style="margin:10px 0 0;font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;line-height:1.35;">
                    ${headline}
                  </h1>
                  <p style="margin:22px 0 0;font-size:14px;line-height:1.65;color:#475569;">
                    <strong style="color:#0f172a;">${name}</strong>
                  </p>
                  ${bodyHtml}
                  ${detailBlock}
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 0;">
                    <tr>
                      <td align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="${BRAND_COLOR}">
                          <tr>
                            <td align="center" style="border-radius:10px;background-color:${BRAND_COLOR};">
                              <a href="${urlEsc}" target="_blank" rel="noopener noreferrer"
                                style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff !important;
                                  text-decoration:none;line-height:1.35;">
                                ${cta}
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:12px;line-height:1.65;color:#64748b;">
                    ${footnote}
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:18px 0 0;background-color:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;">
                    <tr>
                      <td style="padding:12px 14px;">
                        <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                          color:#94a3b8;">Paste in browser if the button does not open</p>
                        <p style="margin:0;font-size:11px;line-height:1.55;color:#475569;font-family:ui-monospace,Consolas,monospace;
                          word-break:break-all;">${urlEsc}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:${BRAND_COLOR};text-align:center;">
                    River&nbsp;PH — disciplined infrastructure for water entrepreneurs.
                  </p>
                  <p style="margin:10px 0 0;font-size:12px;color:#64748b;text-align:center;">
                    <a href="https://riverph.com" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">riverph.com</a>
                  </p>
                  <p style="margin:16px 0 0;font-size:11px;color:#64748b;text-align:center;">©&nbsp;${year}&nbsp;Smart&nbsp;Refill</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      </body>
      </html>
    `.trim();

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
  const year = new Date().getFullYear();
  const emailPlain = input.email.trim();
  const emailEsc = escapeHtmlForEmail(emailPlain);
  const mailtoHrefEsc = escapeHtmlForEmail(`mailto:${emailPlain}`);
  const name = escapeHtmlForEmail(input.displayName.trim() || "there");
  const url = input.verificationLink.trim();
  const urlEsc = escapeHtmlForEmail(url);
  const accountTypeEsc = escapeHtmlForEmail("Station owner");

  const subject = "Verify your email — Smart Refill station account";
  const preheader =
    `Activate ${emailPlain} and unlock your Smart Refill station dashboard.`;
  const headline = "Verify your email address";
  const eyebrow = "Station account · Activation";
  const intro =
    "Welcome to Smart Refill. Confirm your email to activate your owner account and protect access to your station data.";
  const cta = "Confirm email address";
  const brevoTag = "email_verification";

  const stepsPlain =
    "1. Confirm your owner email address.\n" +
    "2. Sign in and finish workspace setup.\n" +
    "3. Unlock your dashboard and operations tools.\n";

  const text =
    `${input.displayName.trim() ? `${input.displayName.trim()},` : "Good day,"}\n\n` +
    `${intro}\n\n` +
    "— Account details —\n" +
    `Email: ${emailPlain}\n` +
    "Type: Station owner\n\n" +
    `— What happens next —\n${stepsPlain}\n` +
    `Confirm your email:\n${url}\n\n` +
    "If you did not create a Smart Refill account, no action is required.\n" +
    `\n—\nSmart Refill\nRiver PH · https://riverph.com/\n© ${year} · All rights reserved`;

  const html = `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml"
        xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="x-apple-disable-message-reformatting" />
          <meta http-equiv="X-UA-Compatible" content="IE=edge" />
          <title>${escapeHtmlForEmail(headline)}</title>
          <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
          <style type="text/css">
              #outlook a { padding: 0; }
              body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
              table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
              img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none;
                text-decoration: none; max-width: 100%; }
              @media only screen and (max-width: 620px) {
                .outer-pad { padding-left: 16px !important; padding-right: 16px !important; }
                .content-pad { padding: 24px 20px !important; }
                .detail-stack td { display: block !important; width: 100% !important; text-align: left !important;
                  padding-bottom: 4px !important; }
                .detail-stack td.val-cell { padding-top: 0 !important; padding-bottom: 14px !important; }
              }
          </style>
      </head>
      <body style="margin:0;padding:0;background-color:#e8eef4;font-family:'Manrope','Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#e8eef4;">
        ${escapeHtmlForEmail(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e8eef4;">
        <tr>
          <td align="center" class="outer-pad" style="padding:28px 14px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="max-width:600px;background-color:#ffffff;border:1px solid #d8e2ec;border-radius:14px;
                overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
              <tr>
                <td style="padding:0;border-bottom:3px solid ${BRAND_COLOR};background-color:#fbfcfd;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="padding:24px 28px 20px;vertical-align:middle;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="vertical-align:middle;padding-right:14px;">
                              <img src="${SMART_REFILL_EMAIL_LOGO_SRC}" width="44" height="44"
                                alt="Smart Refill" style="display:block;border-radius:10px;" />
                            </td>
                            <td style="vertical-align:middle;">
                              <p style="margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;
                                line-height:1.2;">Smart&nbsp;Refill</p>
                              <p style="margin:6px 0 0;font-size:10px;font-weight:600;letter-spacing:0.14em;
                                text-transform:uppercase;color:#64748b;line-height:1.4;">
                                Your operating system for business essentials.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="content-pad" style="padding:32px 32px 28px;">
                  <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
                    color:#64748b;">${escapeHtmlForEmail(eyebrow)}</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;">
                    <tr>
                      <td width="4" style="width:4px;background-color:${BRAND_COLOR};border-radius:2px;font-size:0;">&nbsp;</td>
                      <td style="padding-left:14px;">
                        <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;line-height:1.35;">
                          ${escapeHtmlForEmail(headline)}
                        </h1>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:14px;line-height:1.65;color:#475569;">
                    <strong style="color:#0f172a;">${name}</strong>
                  </p>
                  <p style="margin:14px 0 0;font-size:14px;line-height:1.68;color:#475569;">
                    ${escapeHtmlForEmail(intro)}
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:26px 0 0;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
                    <tr><td style="padding:0;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        ${verificationDetailRowsHtml(emailEsc, mailtoHrefEsc, accountTypeEsc)}
                      </table>
                    </td></tr>
                  </table>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:24px 0 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                    <tr>
                      <td style="padding:16px 18px;">
                        <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                          color:#64748b;">What happens next</p>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          ${verificationStepsHtml(false)}
                        </table>
                      </td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 0;">
                    <tr>
                      <td align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-radius:10px;"
                          bgcolor="${BRAND_COLOR}">
                          <tr>
                            <td align="center" style="border-radius:10px;mso-padding-alt:12px 28px;background-color:${BRAND_COLOR};">
                              <a href="${urlEsc}" target="_blank" rel="noopener noreferrer"
                                title="${escapeHtmlForEmail(cta)}"
                                style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff !important;
                                  text-decoration:none;line-height:1.35;mso-line-height-rule:exactly;">
                                ${escapeHtmlForEmail(cta)}
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:12px;line-height:1.65;color:#64748b;">
                    This confirmation link is single-use. If you did not create a Smart Refill account, your address will remain unverified and no further action is required.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:18px 0 0;background-color:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;">
                    <tr>
                      <td style="padding:12px 14px;">
                        <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                          color:#94a3b8;">Paste in browser if the button does not open</p>
                        <p style="margin:0;font-size:11px;line-height:1.55;color:#475569;font-family:ui-monospace,Consolas,
                          'Courier New',monospace;word-break:break-all;">${urlEsc}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:14px;font-weight:700;line-height:1.45;color:${BRAND_COLOR};text-align:center;">
                    River&nbsp;PH — disciplined infrastructure for water entrepreneurs.
                  </p>
                  <p style="margin:10px 0 0;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                    Learn more:&nbsp;<a href="https://riverph.com" target="_blank" rel="noopener noreferrer"
                      style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">riverph.com</a>
                  </p>
                  <div style="margin-top:18px;padding-top:16px;border-top:1px solid #e2e8f8;font-size:10px;line-height:1.55;
                    color:#7b8794;text-align:left;">
                    <strong>DISCLAIMER:</strong>&nbsp;This communication is confidential and intended strictly for the named
                    recipient(s). If misdelivered, please notify the sender and delete this message. Personal data processed in
                    line with the Data Privacy Act of 2012 (<abbr title="Republic Act">RA</abbr>&nbsp;10173).
                  </div>
                  <p style="margin:16px 0 0;font-size:11px;color:#64748b;text-align:center;line-height:1.5;">
                    ©&nbsp;${year}&nbsp;Smart&nbsp;Refill · All rights reserved
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      </body>
      </html>
    `.trim();

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
