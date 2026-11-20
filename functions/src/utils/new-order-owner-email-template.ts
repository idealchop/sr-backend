import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

export type NewOrderOwnerEmailInput = {
  ownerName: string;
  businessName: string;
  title: string;
  body: string;
  referenceId: string;
  reviewUrl: string;
};

/** Owner inbox notice when a customer requests an online / portal order. */
export function buildNewOrderOwnerEmail(
  input: NewOrderOwnerEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject = `${input.title} · ${input.businessName}`;
  const html = wrapSmartRefillLetterHtml({
    title: input.title,
    headline: input.title,
    greetingName: input.ownerName,
    preheader: input.body,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        ${escapeHtmlForEmail(input.body)}
      </p>
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5e6c84;">Reference</p>
      <p style="margin:0;font-size:16px;font-weight:700;font-family:ui-monospace,monospace;color:#172b4d;">${escapeHtmlForEmail(input.referenceId || "—")}</p>
    `,
    cta: { label: "Review online orders", url: input.reviewUrl },
  });

  const text = [
    input.title,
    input.body,
    input.referenceId ? `Reference: ${input.referenceId}` : "",
    `Review: ${input.reviewUrl}`,
    "",
    buildSmartRefillEmailFooterPlainText(),
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text, brevoTag: "new_order_owner_email" };
}
