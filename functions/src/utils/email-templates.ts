/* eslint-disable max-len */
import type { TeamSeatRole } from "../services/team/team-seat-roles";
import {
  escapeHtmlForEmail,
  getEmailVerificationEmail,
  getPasswordResetEmail,
} from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  smartRefillEmailPasteUrlHtml,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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
  const inviter = escapeHtmlForEmail(
    input.inviterName.trim() || "A workspace representative",
  );
  const org = escapeHtmlForEmail(
    input.organizationName.trim() || "this workspace",
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
    buildSmartRefillEmailFooterPlainText();

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

  const html = wrapSmartRefillLetterHtml({
    title: "Workspace invitation",
    headline: "Workspace invitation",
    preheader,
    greetingName: input.inviteeDisplayName.trim() || input.inviteeEmail.trim() || "there",
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        <strong style="color:#172b4d;">${inviter}</strong> invited you to join
        <strong style="color:#172b4d;">${org}</strong> on Smart Refill as
        <strong style="color:#172b4d;">${roleEsc}</strong>.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin:0 0 8px;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              ${inviteDetailRows()}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">
        This invitation remains valid for <strong>${days} days</strong>.
        If you did not expect this, you can ignore this email. Your inviter (${inviter}) is copied for operational traceability.
      </p>
      ${smartRefillEmailPasteUrlHtml(url)}
    `,
    cta: { label: "Accept", url },
  });

  return { subject, html, text };
}
