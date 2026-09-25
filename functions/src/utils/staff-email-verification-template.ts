/* eslint-disable max-len */
import {
  buildSmartRefillEmailFooterPlainText,
  escapeHtmlForEmail,
  SMART_REFILL_BRAND_TEAL,
  smartRefillEmailPasteUrlHtml,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

const BRAND_COLOR = SMART_REFILL_BRAND_TEAL;

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

  const emailPlain = input.email.trim();
  const emailEsc = escapeHtmlForEmail(emailPlain);
  const mailtoHrefEsc = escapeHtmlForEmail(`mailto:${emailPlain}`);
  const url = input.verificationLink.trim();
  const workspacePlain = (input.workspaceName || "").trim() || "Your Smart Refill workspace";
  const workspaceEsc = escapeHtmlForEmail(workspacePlain);
  const rolePlain = staffRoleLabel(input.memberRole);
  const roleEsc = escapeHtmlForEmail(rolePlain);

  const subject = `Confirm your email — ${workspacePlain} · Smart Refill`;
  const preheader =
    `Verify ${emailPlain} to activate your Smart Refill team access for ${workspacePlain}.`;
  const intro =
    `You were added to ${workspacePlain} on Smart Refill as ${rolePlain}. ` +
    "Confirm this email so we can verify your identity before granting workspace access.";

  const text =
    `Hi ${input.displayName.trim() || "there"},\n\n` +
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
    buildSmartRefillEmailFooterPlainText();

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">
      Team workspace · Email verification
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
      ${escapeHtmlForEmail(intro)}
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 16px;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          ${staffDetailRowsHtml(emailEsc, mailtoHrefEsc, workspaceEsc, roleEsc)}
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">
      What happens next
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${staffOnboardingStepsHtml()}
    </table>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">
      This confirmation link is single-use. If you did not expect a team invitation, you may disregard this notice.
      Contact your station administrator if you need a new link.
    </p>
    ${smartRefillEmailPasteUrlHtml(url)}
  `;

  const html = wrapSmartRefillLetterHtml({
    title: "Confirm your workspace email",
    headline: "Confirm your workspace email",
    preheader,
    greetingName: input.displayName.trim() || "there",
    bodyHtml,
    cta: { label: "Confirm email address", url },
  });

  return {
    subject,
    html,
    text,
    brevoTag: "email_verification_staff",
  };
}
