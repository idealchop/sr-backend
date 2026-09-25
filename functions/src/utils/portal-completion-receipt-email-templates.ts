/* eslint-disable max-len */
import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildCustomerEmailFooterPlainText,
  wrapCustomerLifecycleEmailHtml,
  type CustomerEmailBrand,
} from "./customer-email-branding";

export interface PortalCompletionReceiptEmailInput {
  customerName: string;
  businessName: string;
  businessLogoUrl?: string | null;
  referenceId: string;
  completedAt: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  paymentMethod: string;
  paymentStatus: string;
  /** Online transfer reference when available; omitted for cash. */
  paymentReference?: string | null;
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

/**
 * Formal HTML + plaintext email when a portal order is confirmed complete.
 * @param {PortalCompletionReceiptEmailInput} input Email merge fields.
 * @return {Object} Email subject, html, text, and brevoTag.
 */
export function getPortalCompletionReceiptEmail(
  input: PortalCompletionReceiptEmailInput,
): {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
} {
  const name = escapeHtmlForEmail(input.customerName.trim() || "Customer");
  const business = escapeHtmlForEmail(input.businessName.trim() || "your water station");
  const ref = escapeHtmlForEmail(input.referenceId);
  const subject = `Order complete — Receipt ${input.referenceId} · ${input.businessName}`;
  const brand: CustomerEmailBrand = {
    businessName: input.businessName,
    businessLogoUrl: input.businessLogoUrl,
  };

  const detailRows = [
    { label: "Reference", valueHtml: ref },
    { label: "Completed", valueHtml: escapeHtmlForEmail(input.completedAt) },
    { label: "Total", valueHtml: escapeHtmlForEmail(`₱${input.totalAmount}`) },
    { label: "Amount paid", valueHtml: escapeHtmlForEmail(`₱${input.amountPaid}`) },
    ...(Number.parseFloat(input.balanceDue.replace(/,/g, "")) > 0 ?
      [{ label: "Balance due", valueHtml: escapeHtmlForEmail(`₱${input.balanceDue}`) }] :
      []),
    { label: "Payment method", valueHtml: escapeHtmlForEmail(input.paymentMethod) },
    ...(input.paymentReference != null ?
      [{ label: "Payment reference", valueHtml: escapeHtmlForEmail(input.paymentReference) }] :
      []),
    { label: "Payment status", valueHtml: escapeHtmlForEmail(input.paymentStatus) },
  ];

  const text =
    `Dear ${input.customerName.trim() || "Customer"},\n\n` +
    `Your order with ${input.businessName} has been completed and confirmed.\n\n` +
    `Reference: ${input.referenceId}\n` +
    `Completed: ${input.completedAt}\n` +
    `Total: ₱${input.totalAmount}\n` +
    `Amount paid: ₱${input.amountPaid}\n` +
    (Number.parseFloat(input.balanceDue.replace(/,/g, "")) > 0 ?
      `Balance due: ₱${input.balanceDue}\n` :
      "") +
    `Payment method: ${input.paymentMethod}\n` +
    (input.paymentReference != null ?
      `Payment reference: ${input.paymentReference}\n` :
      "") +
    `Payment status: ${input.paymentStatus}\n\n` +
    "Your official receipt is attached to this email.\n\n" +
    "Thank you for your business.\n\n" +
    buildCustomerEmailFooterPlainText(input.businessName);

  const html = wrapCustomerLifecycleEmailHtml({
    brand,
    eyebrow: "Order confirmation",
    preheader: `Your order ${input.referenceId} with ${input.businessName} is complete. Receipt attached.`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.35;font-weight:700;color:#172b4d;">
        Your order is complete
      </h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        Hi ${name}, your order with <strong>${business}</strong> is done. Your official receipt is attached.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin:0 0 16px;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              ${detailCardHtml(detailRows)}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:1.65;color:#5e6c84;">
        Questions about this order? Contact ${business} directly.
      </p>
    `,
  });

  return {
    subject,
    html,
    text,
    brevoTag: "portal_completion_receipt",
  };
}

/** Plain-text receipt summary for Messenger (matches email body fields). */
export function getPortalCompletionReceiptMessengerText(
  input: PortalCompletionReceiptEmailInput,
): string {
  const template = getPortalCompletionReceiptEmail(input);
  return template.text.replace(
    "Your official receipt is attached to this email.\n\n",
    "Your official receipt PDF is attached in the next message.\n\n",
  );
}
