import { escapeHtmlForEmail } from "./auth-transactional-email";

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

  const bodyStyle =
    "margin:0;padding:24px;background:#f8fafc;" +
    "font-family:system-ui,-apple-system,sans-serif;";
  const cardStyle =
    "max-width:560px;margin:0 auto;background:#fff;border-radius:16px;" +
    "border:1px solid #e2e8f0;padding:28px 24px;";
  const kickerStyle =
    "margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;" +
    "text-transform:uppercase;color:#64748b;";
  const h1Style = "margin:0 0 12px;font-size:22px;color:#0f172a;";
  const bodyTextStyle = "margin:0;font-size:15px;line-height:1.55;color:#334155;";
  const tableStyle = "margin:20px 0 0;width:100%;border-collapse:collapse;font-size:14px;";
  const labelCell = "padding:8px 0;color:#64748b;";
  const revenueCell =
    "padding:8px 0;text-align:right;font-weight:700;color:#e11d48;";
  const cadenceCell =
    "padding:8px 0;text-align:right;font-weight:600;color:#0f172a;";
  const ctaStyle =
    "display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;" +
    "font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;";
  const footerStyle = "margin:20px 0 0;font-size:12px;color:#94a3b8;";

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="${bodyStyle}">
  <div style="${cardStyle}">
    <p style="${kickerStyle}">Weekly retention</p>
    <h1 style="${h1Style}">Hi ${escapeHtmlForEmail(input.ownerName)},</h1>
    <p style="${bodyTextStyle}">
      <strong>${input.dormantCount}</strong> active ${escapeHtmlForEmail(sukiLabel)} at
      <strong>${escapeHtmlForEmail(input.businessName)}</strong> have not ordered recently.
    </p>
    <table style="${tableStyle}">
      <tr>
        <td style="${labelCell}">Revenue at risk</td>
        <td style="${revenueCell}">${escapeHtmlForEmail(revenueLine)}</td>
      </tr>
      <tr>
        <td style="${labelCell}">Late vs usual cadence</td>
        <td style="${cadenceCell}">${input.cadenceLateCount}</td>
      </tr>
    </table>
    ${briefBlock}
    <p style="margin:24px 0 0;">
      <a href="${escapeHtmlForEmail(input.dashboardUrl)}" style="${ctaStyle}">
        Open Forecast
      </a>
    </p>
    <p style="${footerStyle}">
      You receive this because weekly email summary is on in Account → Alerts.
    </p>
  </div>
</body>
</html>`;

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
