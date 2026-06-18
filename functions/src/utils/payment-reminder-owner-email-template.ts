import { escapeHtmlForEmail } from "./auth-transactional-email";
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

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Collections</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Call today — ${count} ${escapeHtmlForEmail(sukiLabel)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">Hi ${escapeHtmlForEmail(input.ownerName)}, ito ang mga suki na naka-queue para sa payment reminder ngayong araw.</p>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr>
          <th align="left" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#64748b;">Suki</th>
          <th align="right" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#64748b;">Utang</th>
          <th align="right" style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#64748b;">Aging</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <a href="${escapeHtmlForEmail(input.dashboardUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Open Command Center</a>
  </div>
</body>
</html>`;

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
