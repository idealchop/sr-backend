/* eslint-disable max-len */
import {
  escapeHtmlForEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./auth-transactional-email";

const BRAND_COLOR = "#44c1ba";

export interface MarketingLeadEmailInput {
  eyebrow: string;
  headline: string;
  preheader: string;
  subject: string;
  detailRows: Array<{ label: string; valueHtml: string; plain: string }>;
  brevoTag: string;
}

function detailCardHtml(
  rows: Array<{ label: string; valueHtml: string; plain: string }>,
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

function row(
  label: string,
  value: string,
): { label: string; valueHtml: string; plain: string } {
  const v = value.trim() || "—";
  return { label, valueHtml: escapeHtmlForEmail(v), plain: v };
}

/**
 * Internal notification email for marketing / partnership leads.
 * @param {MarketingLeadEmailInput} input The input configuration for the email.
 * @return {Object} The compiled email payload.
 */
export function buildMarketingLeadEmail(
  input: MarketingLeadEmailInput,
): {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
} {
  const year = new Date().getFullYear();
  const eyebrow = escapeHtmlForEmail(input.eyebrow);
  const headline = escapeHtmlForEmail(input.headline);
  const preheader = escapeHtmlForEmail(input.preheader);

  const detailBlock = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="margin:26px 0 0;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${detailCardHtml(input.detailRows)}
          </table>
        </td>
      </tr>
    </table>`;

  const textLines = input.detailRows.map((r) => `${r.label}: ${r.plain}`);

  const text =
    `${input.subject}\n\n` +
    `${textLines.join("\n")}\n\n` +
    `—\nSmart Refill\nRiver PH · https://riverph.com/\n© ${year}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background-color:#e8eef4;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e8eef4;">
    <tr>
      <td align="center" style="padding:28px 14px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="max-width:600px;background-color:#ffffff;border:1px solid #d8e2ec;border-radius:14px;">
          <tr>
            <td style="padding:24px 28px;border-bottom:3px solid ${BRAND_COLOR};">
              <img src="${SMART_REFILL_EMAIL_LOGO_SRC}" width="44" height="44" alt="Smart Refill" style="vertical-align:middle;margin-right:12px;" />
              <span style="font-size:20px;font-weight:700;color:#0f172a;vertical-align:middle;">Smart Refill</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">${eyebrow}</p>
              <h1 style="margin:10px 0 0;font-size:18px;font-weight:700;color:#0f172a;">${headline}</h1>
              <p style="margin:18px 0 0;font-size:14px;line-height:1.65;color:#475569;">
                A new submission was received from the website. Details are below.
              </p>
              ${detailBlock}
              <p style="margin:24px 0 0;font-size:12px;color:#64748b;">Reply directly to the lead using the email address above.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
              © ${year} Smart Refill · River Tech Inc.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: input.subject,
    html,
    text,
    brevoTag: input.brevoTag,
  };
}

export function getRequestDemoLeadEmail(data: {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  stationCount?: string;
  requestedDate?: string;
}) {
  return buildMarketingLeadEmail({
    eyebrow: "Marketing",
    headline: "New demo request",
    preheader: `Demo request from ${data.name}`,
    subject: `Demo request — ${data.businessName}`,
    brevoTag: "marketing-request-demo",
    detailRows: [
      row("Name", data.name),
      row("Email", data.email),
      row("Phone", data.phone),
      row("Business", data.businessName),
      row("Stations", data.stationCount ?? "—"),
      row("Preferred date", data.requestedDate ?? "—"),
    ],
  });
}

export function getInquiryLeadEmail(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  businessAddress: string;
  message: string;
}) {
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  return buildMarketingLeadEmail({
    eyebrow: "About us",
    headline: "New partnership inquiry",
    preheader: `Inquiry from ${fullName}`,
    subject: `Inquiry — ${data.company}`,
    brevoTag: "marketing-inquiry",
    detailRows: [
      row("Name", fullName),
      row("Email", data.email),
      row("Phone", data.phone),
      row("Company", data.company),
      row("Address", data.businessAddress),
      row("Message", data.message),
    ],
  });
}

export function getPartnerApplicationLeadEmail(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stationName: string;
  address: string;
  latitude?: string;
  longitude?: string;
  waterTypes: string;
  hasPermits: string;
  stationAge: string;
  deliveryVehicles: string;
  productionCapacity: string;
  preferredClients: string;
  providesContainers: string;
  providesDispensers: string;
  onboardingSchedule: string;
}) {
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  return buildMarketingLeadEmail({
    eyebrow: "Partnership",
    headline: "New partner application",
    preheader: `Application from ${data.stationName}`,
    subject: `Partner application — ${data.stationName}`,
    brevoTag: "marketing-partner-application",
    detailRows: [
      row("Name", fullName),
      row("Email", data.email),
      row("Phone", data.phone),
      row("Station", data.stationName),
      row("Address", data.address),
      row("Coordinates", `${data.latitude ?? "—"}, ${data.longitude ?? "—"}`),
      row("Water types", data.waterTypes),
      row("Permits updated", data.hasPermits),
      row("Station age (yrs)", data.stationAge),
      row("Delivery vehicles", data.deliveryVehicles),
      row("Daily capacity", data.productionCapacity),
      row("Preferred clients", data.preferredClients),
      row("Provides containers", data.providesContainers),
      row("Provides dispensers", data.providesDispensers),
      row("Onboarding schedule", data.onboardingSchedule),
    ],
  });
}
