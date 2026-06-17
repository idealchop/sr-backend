/* eslint-disable max-len */
import {
  escapeHtmlForEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./auth-transactional-email";

const BRAND_COLOR = "#44c1ba";

export interface StaffEmailVerificationInput {
  displayName: string;
  email: string;
  verificationLink: string;
  /** Station / workspace name when known */
  workspaceName?: string;
  /** Member role key from Firestore (`admin` | `rider` | `staff`) */
  memberRole?: string;
}

function staffRoleLabel(roleKey?: string): string {
  const role = String(roleKey || "").trim().toLowerCase();
  if (role === "admin") return "Administrator";
  if (role === "rider") return "Rider / Operator";
  if (role === "staff") return "Staff member";
  return "Team member";
}

function staffDetailRowsHtml(
  emailEsc: string,
  mailtoHrefEsc: string,
  workspaceEsc: string,
  roleEsc: string,
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
    row("Workspace", `<span style="color:#0f172a;">${workspaceEsc}</span>`, true) +
    row("Assigned role", `<span style="color:#0f172a;">${roleEsc}</span>`, true) +
    row(
      "Verification",
      "<span style=\"color:#0f172a;\">One-time secure link</span>",
      false,
    )
  );
}

function staffOnboardingStepsHtml(): string {
  const steps = [
    "Confirm this email matches the address your station administrator registered.",
    "Sign in to Smart Refill with the password you created during invite acceptance.",
    "Complete staff onboarding, then open My Area or your assigned workspace tools.",
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

/**
 * Dedicated staff / team-member verification email (invite-parity layout).
 * @param {StaffEmailVerificationInput} input Template inputs.
 * @return {{ subject: string, html: string, text: string, brevoTag: string }}
 */
export function getStaffEmailVerificationEmail(
  input: StaffEmailVerificationInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const year = new Date().getFullYear();
  const emailPlain = input.email.trim();
  const emailEsc = escapeHtmlForEmail(emailPlain);
  const mailtoHrefEsc = escapeHtmlForEmail(`mailto:${emailPlain}`);
  const name = escapeHtmlForEmail(input.displayName.trim() || "there");
  const url = input.verificationLink.trim();
  const urlEsc = escapeHtmlForEmail(url);
  const workspacePlain = (input.workspaceName || "").trim() || "Your Smart Refill workspace";
  const workspaceEsc = escapeHtmlForEmail(workspacePlain);
  const rolePlain = staffRoleLabel(input.memberRole);
  const roleEsc = escapeHtmlForEmail(rolePlain);

  const subject = `Confirm your email — ${workspacePlain} · Smart Refill`;
  const preheader =
    `Verify ${emailPlain} to activate your Smart Refill team access for ${workspacePlain}.`;
  const intro =
    `You were added to ${workspacePlain} on Smart Refill as ${rolePlain}. ` +
    "Please confirm this email address so we can verify your identity before granting workspace access.";

  const text =
    `${input.displayName.trim() ? `${input.displayName.trim()},` : "Good day,"}\n\n` +
    `${intro}\n\n` +
    "— Account details —\n" +
    `Email: ${emailPlain}\n` +
    `Workspace: ${workspacePlain}\n` +
    `Role: ${rolePlain}\n\n` +
    "— What happens next —\n" +
    "1. Confirm this email matches your team profile.\n" +
    "2. Sign in with your Smart Refill credentials.\n" +
    "3. Complete staff onboarding and open your workspace.\n\n" +
    `Confirm your email:\n${url}\n\n` +
    "If you did not expect a team invitation, you may ignore this message. " +
    "Contact your station administrator if you need a new link.\n\n" +
    `—\nSmart Refill\nRiver PH · https://riverph.com/\n© ${year} · All rights reserved`;

  const html = `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml"
        xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="x-apple-disable-message-reformatting" />
          <meta http-equiv="X-UA-Compatible" content="IE=edge" />
          <title>Confirm your workspace email</title>
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
                    color:#64748b;">Team workspace · Email verification</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;">
                    <tr>
                      <td width="4" style="width:4px;background-color:${BRAND_COLOR};border-radius:2px;font-size:0;">&nbsp;</td>
                      <td style="padding-left:14px;">
                        <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;line-height:1.35;">
                          Confirm your workspace email
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
                        ${staffDetailRowsHtml(emailEsc, mailtoHrefEsc, workspaceEsc, roleEsc)}
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
                          ${staffOnboardingStepsHtml()}
                        </table>
                      </td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 0;">
                    <tr>
                      <td align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="${BRAND_COLOR}">
                          <tr>
                            <td align="center" style="border-radius:10px;mso-padding-alt:12px 28px;background-color:${BRAND_COLOR};">
                              <a href="${urlEsc}" target="_blank" rel="noopener noreferrer"
                                title="Confirm email address"
                                style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff !important;
                                  text-decoration:none;line-height:1.35;mso-line-height-rule:exactly;">
                                Confirm email address
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:12px;line-height:1.65;color:#64748b;">
                    This confirmation link is single-use. If you did not expect a team invitation, you may disregard this notice.
                    Contact your station administrator if you need a new link.
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

  return {
    subject,
    html,
    text,
    brevoTag: "email_verification_staff",
  };
}
