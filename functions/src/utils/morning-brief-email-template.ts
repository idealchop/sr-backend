import { escapeHtmlForEmail } from "./auth-transactional-email";

export type MorningBriefEmailInput = {
  ownerName: string;
  businessName: string;
  briefTitle: string;
  briefSummary: string;
  highlights: string[];
  actionItems?: Array<{ label: string; detail: string }>;
  dashboardUrl: string;
  historyUrl?: string;
};

/** NT-20 — daily morning brief email body from latest River AI run. */
export function buildMorningBriefEmail(
  input: MorningBriefEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const subject = `${input.briefTitle} — ${input.businessName}`;
  const highlightHtml = input.highlights
    .slice(0, 6)
    .map(
      (h) =>
        `<li style="margin:0 0 8px;font-size:14px;line-height:1.45;color:#334155;">${escapeHtmlForEmail(h)}</li>`,
    )
    .join("");

  const actionHtml = (input.actionItems ?? [])
    .slice(0, 5)
    .map(
      (item) =>
        "<li style=\"margin:0 0 10px;font-size:14px;line-height:1.45;color:#334155;\">" +
        `<strong>${escapeHtmlForEmail(item.label)}</strong> — ${escapeHtmlForEmail(item.detail)}</li>`,
    )
    .join("");

  const historyBlock = input.historyUrl ?
    `<p style="margin:16px 0 0;font-size:13px;"><a href="${escapeHtmlForEmail(input.historyUrl)}" style="color:#0d9488;font-weight:600;">View full River AI brief history</a></p>` :
    "";

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Morning brief</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(input.briefTitle)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#334155;">${escapeHtmlForEmail(input.briefSummary)}</p>
    ${highlightHtml ? `<ul style="margin:0 0 20px;padding-left:20px;">${highlightHtml}</ul>` : ""}
    ${actionHtml ? `<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Today's actions</p><ul style="margin:0 0 20px;padding-left:20px;">${actionHtml}</ul>` : ""}
    <a href="${escapeHtmlForEmail(input.dashboardUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Open dashboard</a>
    ${historyBlock}
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">Good morning, ${escapeHtmlForEmail(input.ownerName)} — bukas ang full River AI history sa app.</p>
  </div>
</body>
</html>`;

  const text = [
    input.briefTitle,
    input.briefSummary,
    ...input.highlights.slice(0, 6).map((h) => `• ${h}`),
    ...(input.actionItems ?? []).slice(0, 5).map((a) => `→ ${a.label}: ${a.detail}`),
    `Dashboard: ${input.dashboardUrl}`,
    input.historyUrl ? `History: ${input.historyUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text, brevoTag: "morning_brief_email" };
}
