/* eslint-disable max-len */
import type { TeamSeatRole } from "../services/team/team-seat-roles";
import {
  escapeHtmlForEmail,
  getEmailVerificationEmail,
  getPasswordResetEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./auth-transactional-email";

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** @deprecated Prefer getEmailVerificationEmail */
export function getSmartRefillVerificationTemplate(
  username: string,
  verificationLink: string,
) {
  const tpl = getEmailVerificationEmail({
    displayName: username,
    email: "",
    verificationLink,
  });
  return { subject: tpl.subject, html: tpl.html };
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** @deprecated Prefer getPasswordResetEmail */
export function getForgotPasswordTemplate(username: string, resetLink: string) {
  const tpl = getPasswordResetEmail({
    displayName: username,
    email: "",
    resetLink,
  });
  return { subject: tpl.subject, html: tpl.html };
}

export interface TeamWorkspaceInviteEmailInput {
  acceptInviteUrl: string;
  inviterName: string;
  inviteeDisplayName: string;
  inviteeEmail: string;
  organizationName: string;
  roleKey: TeamSeatRole;
  validityDays: number;
}

function invitationRoleLabel(roleKey: TeamSeatRole): string {
  return roleKey === "admin" ? "Administrator" : "Rider / Operator";
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** Formal transactional email for workspace invitations (HTML + plaintext for Brevo SMTP). */
export function getTeamWorkspaceInviteEmail(
  input: TeamWorkspaceInviteEmailInput,
): {
  subject: string;
  html: string;
  text: string;
} {
  const brandColor = "#44c1ba";
  const year = new Date().getFullYear();
  const inviter = escapeHtmlForEmail(
    input.inviterName.trim() || "A workspace representative",
  );
  const org = escapeHtmlForEmail(
    input.organizationName.trim() || "this workspace",
  );
  const invitee = escapeHtmlForEmail(
    input.inviteeDisplayName.trim() || input.inviteeEmail.trim(),
  );
  const emailEsc = escapeHtmlForEmail(input.inviteeEmail.trim());
  const rolePh = invitationRoleLabel(input.roleKey);
  const roleEsc = escapeHtmlForEmail(rolePh);
  const url = input.acceptInviteUrl.trim();
  const days =
    Number.isFinite(input.validityDays) && input.validityDays > 0 ?
      Math.floor(input.validityDays) :
      7;

  const orgPlain = input.organizationName.trim() || "Workspace";
  const subject = `Workspace invitation — ${orgPlain} · Smart Refill`;
  const preheader = `${input.inviterName.trim() || "A colleague"} invited you to ${orgPlain} on Smart Refill. Valid ${days} days.`;
  const text =
    `${input.inviteeDisplayName.trim() ? `${input.inviteeDisplayName.trim()},` : "Good day,"}\n\n` +
    `${input.inviterName.trim() || "A colleague"} has invited you to join "${orgPlain}" on Smart Refill as ${rolePh}.\n\n` +
    "— Invitation details —\n" +
    `Inviting party: ${input.inviterName.trim() || "—"}\n` +
    `Organization: ${orgPlain}\n` +
    `Invitation email: ${input.inviteeEmail.trim()}\n` +
    `Assigned role: ${rolePh}\n\n` +
    `Accept this invitation (${days}-day link validity):\n${url}\n\n` +
    `A copy is sent to ${input.inviterName.trim() || "the inviting party"} for operational traceability. ` +
    "If you did not expect this message, you may disregard it.\n\n" +
    `—\nSmart Refill\nRiver PH · https://riverph.com/\n© ${year} · All rights reserved`;

  const mailtoHref = `mailto:${input.inviteeEmail.trim()}`;
  const mailtoHrefEsc = escapeHtmlForEmail(mailtoHref);

  const inviteDetailRows = (): string => {
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
        "Inviting party",
        `<span style="color:#0f172a;">${inviter}</span>`,
        true,
      ) +
      row("Organization", `<span style="color:#0f172a;">${org}</span>`, true) +
      row(
        "Invitation email",
        `<a href="${mailtoHrefEsc}" style="color:#2563eb;font-weight:600;text-decoration:none;">${emailEsc}</a>`,
        true,
      ) +
      row(
        "Assigned role",
        `<span style="color:#0f172a;">${roleEsc}</span>`,
        false,
      )
    );
  };

  const html = `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml"
        xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="x-apple-disable-message-reformatting" />
          <meta http-equiv="X-UA-Compatible" content="IE=edge" />
          <title>Workspace invitation</title>
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
                <td style="padding:0;border-bottom:3px solid ${brandColor};background-color:#fbfcfd;">
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
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="4" style="width:4px;background-color:${brandColor};border-radius:2px;font-size:0;line-height:0;">
                        &nbsp;
                      </td>
                      <td style="padding-left:14px;">
                        <h1 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;
                          line-height:1.35;">Workspace invitation</h1>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:14px;line-height:1.65;color:#475569;">
                    <strong style="color:#0f172a;">${invitee}</strong>
                  </p>
                  <p style="margin:14px 0 0;font-size:14px;line-height:1.68;color:#475569;">
                    <strong style="color:#0f172a;">${inviter}</strong> has invited you to join
                    <strong style="color:#0f172a;">${org}</strong> on Smart&nbsp;Refill. On acceptance you will onboard as
                    <strong style="color:#0f172a;">${roleEsc}</strong>, with access aligned to responsibilities for this workspace.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:26px 0 0;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
                    <tr>
                      <td style="padding:0;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          ${inviteDetailRows()}
                        </table>
                      </td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 0;">
                    <tr>
                      <td align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-radius:10px;"
                          bgcolor="${brandColor}">
                          <tr>
                            <td align="center" style="border-radius:10px;mso-padding-alt:12px 28px;background-color:${brandColor};">
                              <a href="${escapeHtmlForEmail(url)}" target="_blank" rel="noopener noreferrer"
                                title="Accept invitation"
                                style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff !important;
                                  text-decoration:none;line-height:1.35;mso-line-height-rule:exactly;">
                                Accept
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:22px 0 0;font-size:12px;line-height:1.65;color:#64748b;">
                    This invitation link remains valid for <strong style="color:#475569;">${days}&nbsp;days</strong>.
                    If you did not request access, you may disregard this notice. Your inviter
                    (${inviter}) is copied on this message for operational traceability.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                    style="margin:18px 0 0;background-color:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;">
                    <tr>
                      <td style="padding:12px 14px;">
                        <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                          color:#94a3b8;">Paste in browser if the button does not open</p>
                        <p style="margin:0;font-size:11px;line-height:1.55;color:#475569;font-family:ui-monospace,Consolas,
                          'Courier New',monospace;word-break:break-all;">${escapeHtmlForEmail(url)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:14px;font-weight:700;line-height:1.45;color:${brandColor};text-align:center;">
                    River&nbsp;PH — disciplined infrastructure for water entrepreneurs.
                  </p>
                  <p style="margin:10px 0 0;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                    Learn more:&nbsp;<a href="https://riverph.com" target="_blank" rel="noopener noreferrer"
                      style="color:${brandColor};font-weight:600;text-decoration:none;">riverph.com</a>
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
    `;

  return { subject, html: html.trim(), text };
}
