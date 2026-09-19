import {
  escapeHtmlForEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./auth-transactional-email";
import {
  SMARTREFILL_EMAIL_CONTACT_MAILTO,
  SMARTREFILL_EMAIL_CONTACT_URL,
  buildSmartRefillEmailLegalFooterHtml,
  buildSmartRefillEmailLegalFooterPlainText,
} from "./smartrefill-email-legal-footer";
import { INACTIVE_ACCOUNT_UNUSED_DAYS } from "./inactive-account-deactivation-policy";

export { INACTIVE_ACCOUNT_UNUSED_DAYS } from "./inactive-account-deactivation-policy";

export type InactiveAccountDeactivationEmailInput = {
  ownerName: string;
  businessName: string;
  unusedDays?: number;
  loginUrl: string;
};

/** Owner email when a workspace is deactivated after 30+ days without use. */
export function buildInactiveAccountDeactivationEmail(
  input: InactiveAccountDeactivationEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const name = input.ownerName.trim() || "there";
  const station = input.businessName.trim() || "your Smart Refill workspace";
  const days = input.unusedDays ?? INACTIVE_ACCOUNT_UNUSED_DAYS;
  const subject =
    "Your Smart Refill workspace is being deactivated due to inactivity";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlForEmail(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#172b4d;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;">
          <tr>
            <td align="center" style="padding:0 0 24px;">
              <img src="${SMART_REFILL_EMAIL_LOGO_SRC}" width="48" height="48" alt="Smart Refill" style="display:block;" />
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #dfe1e6;padding:28px 8px 8px;">
              <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#172b4d;">
                Your workspace is being deactivated due to inactivity
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${escapeHtmlForEmail(name)},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
                We're reaching out to let you know that your Smart Refill workspace,
                <strong>${escapeHtmlForEmail(station)}</strong>, is being deactivated due to
                ${days} days without use. You will no longer be able to access this workspace,
                and any data associated with it may be permanently deleted soon.
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
                If you need assistance or have questions, please
                <a href="${SMARTREFILL_EMAIL_CONTACT_MAILTO}" style="color:#2563eb;font-weight:600;text-decoration:none;">contact us</a>
                immediately.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
                Still using this station? Sign in to keep the workspace active.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td style="border-radius:8px;background-color:#44c1ba;">
                    <a href="${escapeHtmlForEmail(input.loginUrl)}"
                      style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Sign in to keep this workspace
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:15px;line-height:1.6;">
                Cheers,<br />The Smart Refill team
              </p>
              ${buildSmartRefillEmailLegalFooterHtml()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = [
    "Your workspace is being deactivated due to inactivity",
    "",
    `Hi ${name},`,
    "",
    `We're reaching out to let you know that your Smart Refill workspace, ${station}, is being deactivated due to ${days} days without use. You will no longer be able to access this workspace, and any data associated with it may be permanently deleted soon.`,
    "",
    `Contact us: ${SMARTREFILL_EMAIL_CONTACT_URL}`,
    `Sign in to keep this workspace: ${input.loginUrl}`,
    "",
    "Cheers,",
    "The Smart Refill team",
    "",
    buildSmartRefillEmailLegalFooterPlainText(),
  ].join("\n");

  return {
    subject,
    html,
    text,
    brevoTag: "inactive_account_deactivation_email",
  };
}
