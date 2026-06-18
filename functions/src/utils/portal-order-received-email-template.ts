import { escapeHtmlForEmail } from "./auth-transactional-email";

export type PortalOrderReceivedEmailInput = {
  customerName: string;
  businessName: string;
  referenceId: string;
  trackUrl: string;
  scheduledLabel?: string;
};

/** NT-31 — customer order placed confirmation email. */
export function buildPortalOrderReceivedEmail(
  input: PortalOrderReceivedEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject = `Order received — ${input.referenceId} · ${input.businessName}`;
  const scheduleLine = input.scheduledLabel ?
    `<p style="margin:0 0 12px;font-size:14px;color:#334155;">Scheduled: <strong>${escapeHtmlForEmail(input.scheduledLabel)}</strong></p>` :
    "";

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Order received</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Salamat, ${escapeHtmlForEmail(input.customerName)}!</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Natanggap na namin ang order mo sa <strong>${escapeHtmlForEmail(input.businessName)}</strong>.
      I-save ang reference ID para ma-track mo ang status.
    </p>
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Reference</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#0f172a;">${escapeHtmlForEmail(input.referenceId)}</p>
    ${scheduleLine}
    <a href="${escapeHtmlForEmail(input.trackUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Track order</a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
      Kung hindi gumana ang button, i-copy ang link: ${escapeHtmlForEmail(input.trackUrl)}
    </p>
  </div>
</body>
</html>`;

  const text = [
    `Order received — ${input.referenceId}`,
    `${input.businessName}`,
    input.scheduledLabel ? `Scheduled: ${input.scheduledLabel}` : "",
    `Track: ${input.trackUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text, brevoTag: "portal_order_received" };
}
