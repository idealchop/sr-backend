import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  type CustomerEmailBrand,
  wrapCustomerLifecycleEmailHtml,
} from "./customer-email-branding";

export type CustomerPaymentUpdateEmailInput = {
  customerName: string;
  businessName: string;
  businessLogoUrl?: string | null;
  referenceId: string;
  trackUrl: string;
  statusLabel: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  detailLine: string;
};

/** Customer email when ledger payment status is partial or paid. */
export function buildCustomerPaymentUpdateEmail(
  input: CustomerPaymentUpdateEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject = `${input.statusLabel} — ${input.referenceId} · ${input.businessName}`;
  const brand: CustomerEmailBrand = {
    businessName: input.businessName,
    businessLogoUrl: input.businessLogoUrl,
  };

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Payment update</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(input.statusLabel)}</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#334155;">Hi ${escapeHtmlForEmail(input.customerName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtmlForEmail(input.detailLine)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="margin:0 0 16px;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">Total</span>
          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtmlForEmail(input.totalAmount)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">Amount paid</span>
          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtmlForEmail(input.amountPaid)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">Balance due</span>
          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtmlForEmail(input.balanceDue)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Reference</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#0f172a;">${escapeHtmlForEmail(input.referenceId)}</p>
    <a href="${escapeHtmlForEmail(input.trackUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Track order</a>`;

  const html = wrapCustomerLifecycleEmailHtml({
    brand,
    eyebrow: "Payment update",
    preheader: `${input.statusLabel} — ${input.referenceId}`,
    bodyHtml,
  });

  const text = [
    input.statusLabel,
    input.detailLine,
    `Total: ${input.totalAmount}`,
    `Amount paid: ${input.amountPaid}`,
    `Balance due: ${input.balanceDue}`,
    `Reference: ${input.referenceId}`,
    `Track: ${input.trackUrl}`,
  ].join("\n");

  return { subject, html, text, brevoTag: "customer_payment_update" };
}
