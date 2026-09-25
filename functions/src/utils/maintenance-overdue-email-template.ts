import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

export type MaintenanceOverdueEmailInput = {
  ownerName: string;
  businessName: string;
  overdueNames: string[];
  overdueCount: number;
  dashboardUrl: string;
};

/** NT-25 — weekly owner email for overdue plant maintenance. */
export function buildMaintenanceOverdueOwnerEmail(
  input: MaintenanceOverdueEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject =
    `${input.overdueCount} plant task${input.overdueCount === 1 ? "" : "s"} overdue — ` +
    input.businessName;
  const listHtml = input.overdueNames
    .slice(0, 12)
    .map(
      (name) =>
        `<li style="margin:0 0 6px;font-size:14px;color:#334155;">${escapeHtmlForEmail(name)}</li>`,
    )
    .join("");
  const extra =
    input.overdueCount > input.overdueNames.length ?
      `<p style="margin:8px 0 0;font-size:13px;color:#64748b;">+${input.overdueCount - input.overdueNames.length} more</p>` :
      "";

  const html = wrapSmartRefillLetterHtml({
    title: `${input.overdueCount} overdue task${input.overdueCount === 1 ? "" : "s"}`,
    headline: `${input.overdueCount} overdue task${input.overdueCount === 1 ? "" : "s"}`,
    greetingName: input.ownerName,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        Preventive maintenance is overdue at <strong>${escapeHtmlForEmail(input.businessName)}</strong>.
      </p>
      <ul style="margin:0 0 16px;padding-left:20px;">${listHtml}</ul>
      ${extra}
    `,
    cta: { label: "Open Plant ops", url: input.dashboardUrl },
  });

  const text = [
    `${input.overdueCount} overdue maintenance tasks`,
    ...input.overdueNames.slice(0, 12).map((n) => `• ${n}`),
    `Dashboard: ${input.dashboardUrl}`,
    "",
    buildSmartRefillEmailFooterPlainText(),
  ].join("\n");

  return { subject, html, text, brevoTag: "maintenance_overdue_email" };
}
