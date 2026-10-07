import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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

  const html = wrapSmartRefillLetterHtml({
    title: input.briefTitle,
    headline: input.briefTitle,
    greetingName: input.ownerName,
    preheader: `${input.briefTitle} — ${input.businessName}`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">${escapeHtmlForEmail(input.briefSummary)}</p>
      ${highlightHtml ? `<ul style="margin:0 0 20px;padding-left:20px;">${highlightHtml}</ul>` : ""}
      ${actionHtml ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">Today's actions</p><ul style="margin:0 0 8px;padding-left:20px;">${actionHtml}</ul>` : ""}
      ${historyBlock}
    `,
    cta: { label: "Open dashboard", url: input.dashboardUrl },
  });

  const text = [
    input.briefTitle,
    input.briefSummary,
    ...input.highlights.slice(0, 6).map((h) => `• ${h}`),
    ...(input.actionItems ?? []).slice(0, 5).map((a) => `→ ${a.label}: ${a.detail}`),
    `Dashboard: ${input.dashboardUrl}`,
    input.historyUrl ? `History: ${input.historyUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n") + "\n\n" + buildSmartRefillEmailFooterPlainText();

  return { subject, html, text, brevoTag: "morning_brief_email" };
}
