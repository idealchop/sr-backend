import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  type CustomerEmailBrand,
  wrapCustomerLifecycleEmailHtml,
} from "./customer-email-branding";

export type CustomerTxnStatusEmailInput = {
  customerName: string;
  businessName: string;
  businessLogoUrl?: string | null;
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

  const brand: CustomerEmailBrand = {
    businessName: input.businessName,
    businessLogoUrl: input.businessLogoUrl,
  };

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Order update</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(input.statusLabel)}</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#334155;">Hi ${escapeHtmlForEmail(input.customerName)},</p>
    ${detail}
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Reference</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#0f172a;">${escapeHtmlForEmail(input.referenceId)}</p>
    <a href="${escapeHtmlForEmail(input.trackUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Track order</a>`;

  const html = wrapCustomerLifecycleEmailHtml({
    brand,
    eyebrow: "Order update",
    preheader: `${input.statusLabel} — ${input.referenceId}`,
    bodyHtml,
  });

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
