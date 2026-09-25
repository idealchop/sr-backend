import { escapeHtmlForEmail } from "./auth-transactional-email";
import { wrapSmartRefillLetterHtml } from "./smartrefill-email-html";

export type DormantDigestEmailInput = {
  businessName: string;
  ownerName: string;
  dormantCount: number;
  revenueAtRiskPhp: number;
  cadenceLateCount: number;
  dashboardUrl: string;
  morningBriefSummary?: string | null;
};

export function buildDormantDigestEmail(
  input: DormantDigestEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const sukiLabel = input.dormantCount === 1 ? "suki" : "sukis";
  const revenueLine =
    input.revenueAtRiskPhp > 0 ?
      `₱${Math.round(input.revenueAtRiskPhp).toLocaleString("en-PH")}` :
      "—";
  const subject = `${input.dormantCount} dormant ${sukiLabel} — ${input.businessName}`;

  const briefBlock = input.morningBriefSummary?.trim() ?
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#334155;">
        <strong style="color:#0f172a;">River AI brief:</strong>
        ${escapeHtmlForEmail(input.morningBriefSummary.trim())}
      </p>` :
    "";

  const html = wrapSmartRefillLetterHtml({
    title: subject,
    headline: `${input.dormantCount} dormant ${sukiLabel}`,
    greetingName: input.ownerName,
    notice:
      "You receive this because weekly email summary is on in Account → Alerts.",
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        <strong>${input.dormantCount}</strong> active ${escapeHtmlForEmail(sukiLabel)} at
        <strong>${escapeHtmlForEmail(input.businessName)}</strong> have not ordered recently.
      </p>
      <table style="margin:0;width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:8px 0;color:#5e6c84;">Revenue at risk</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:#e11d48;">${escapeHtmlForEmail(revenueLine)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#5e6c84;">Late vs usual cadence</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;color:#172b4d;">${input.cadenceLateCount}</td>
        </tr>
      </table>
      ${briefBlock}
    `,
    cta: { label: "Open Forecast", url: input.dashboardUrl },
  });

  const textLines = [
    `Hi ${input.ownerName},`,
    "",
    `${input.dormantCount} dormant ${sukiLabel} at ${input.businessName}.`,
    `Revenue at risk: ${revenueLine}`,
    `Late vs usual cadence: ${input.cadenceLateCount}`,
  ];
  if (input.morningBriefSummary?.trim()) {
    textLines.push("", `River AI brief: ${input.morningBriefSummary.trim()}`);
  }
  textLines.push("", `Open Forecast: ${input.dashboardUrl}`);

  return {
    subject,
    html,
    text: textLines.join("\n"),
    brevoTag: "dormant_digest_weekly",
  };
}
