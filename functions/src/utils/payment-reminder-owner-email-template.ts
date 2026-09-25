import { escapeHtmlForEmail } from "./auth-transactional-email";
import { wrapSmartRefillLetterHtml } from "./smartrefill-email-html";
import type { PaymentReminderQueueRow } from "./payment-reminder-queue";

export type PaymentReminderOwnerEmailInput = {
  ownerName: string;
  businessName: string;
  queue: PaymentReminderQueueRow[];
  dashboardUrl: string;
};

/** NT-21 — owner email with call-today payment reminder list. */
export function buildPaymentReminderOwnerEmail(
  input: PaymentReminderOwnerEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const count = input.queue.length;
  const sukiLabel = count === 1 ? "suki" : "sukis";
  const subject = `Call today — ${count} ${sukiLabel} with utang · ${input.businessName}`;

  const rowsHtml = input.queue
    .slice(0, 15)
    .map((row) => {
      const amount = row.amount.toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${escapeHtmlForEmail(row.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:#0f172a;">₱${amount}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:#64748b;">${row.oldestDebtDays}d · ${row.reminderTier}+</td>
      </tr>`;
    })
    .join("");

  const html = wrapSmartRefillLetterHtml({
    title: `Call today — ${count} ${sukiLabel}`,
    headline: `Call today — ${count} ${sukiLabel}`,
    greetingName: input.ownerName,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        These sukis at ${escapeHtmlForEmail(input.businessName)} are queued for a payment reminder today.
      </p>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:8px;">
        <thead>
          <tr>
            <th align="left" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#5e6c84;">Suki</th>
            <th align="right" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#5e6c84;">Utang</th>
            <th align="right" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#5e6c84;">Aging</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `,
    cta: { label: "Open Command Center", url: input.dashboardUrl },
  });

  const text = [
    `Call today — ${count} ${sukiLabel}`,
    ...input.queue.slice(0, 15).map(
      (row) =>
        `${row.name}: ₱${row.amount.toFixed(2)} (${row.oldestDebtDays}d, ${row.reminderTier}+)`,
    ),
    `Dashboard: ${input.dashboardUrl}`,
  ].join("\n");

  return { subject, html, text, brevoTag: "payment_reminder_owner_email" };
}
