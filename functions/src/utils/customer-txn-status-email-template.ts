import { escapeHtmlForEmail } from "./auth-transactional-email";

export type CustomerTxnStatusEmailInput = {
  customerName: string;
  businessName: string;
  referenceId: string;
  statusLabel: string;
  trackUrl: string;
  detailLine?: string;
};

/** NT-32 — lifecycle status email for portal customers. */
export function buildCustomerTxnStatusEmail(
  input: CustomerTxnStatusEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject = `${input.statusLabel} — ${input.referenceId} · ${input.businessName}`;
  const detail = input.detailLine ?
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtmlForEmail(input.detailLine)}</p>` :
    "";

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Order update</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(input.statusLabel)}</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#334155;">Hi ${escapeHtmlForEmail(input.customerName)},</p>
    ${detail}
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Reference</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#0f172a;">${escapeHtmlForEmail(input.referenceId)}</p>
    <a href="${escapeHtmlForEmail(input.trackUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Track order</a>
  </div>
</body>
</html>`;

  const text = [
    input.statusLabel,
    input.detailLine || "",
    `Reference: ${input.referenceId}`,
    `Track: ${input.trackUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text, brevoTag: "customer_txn_status" };
}
