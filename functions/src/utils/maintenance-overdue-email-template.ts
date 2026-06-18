import { escapeHtmlForEmail } from "./auth-transactional-email";

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

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Plant maintenance</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${input.overdueCount} overdue task${input.overdueCount === 1 ? "" : "s"}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(input.ownerName)}, may overdue preventive maintenance sa
      <strong>${escapeHtmlForEmail(input.businessName)}</strong>.
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;">${listHtml}</ul>
    ${extra}
    <a href="${escapeHtmlForEmail(input.dashboardUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Open Plant ops</a>
  </div>
</body>
</html>`;

  const text = [
    `${input.overdueCount} overdue maintenance tasks`,
    ...input.overdueNames.slice(0, 12).map((n) => `• ${n}`),
    `Dashboard: ${input.dashboardUrl}`,
  ].join("\n");

  return { subject, html, text, brevoTag: "maintenance_overdue_email" };
}
