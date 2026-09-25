/* eslint-disable max-len */
import {
  escapeHtmlForEmail,
} from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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
  const eyebrow = escapeHtmlForEmail(input.eyebrow);

  const detailBlock = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="margin:8px 0 0;background-color:#f4f5f7;border:1px solid #dfe1e6;border-radius:6px;">
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
    buildSmartRefillEmailFooterPlainText();

  const html = wrapSmartRefillLetterHtml({
    title: input.headline,
    headline: input.headline,
    preheader: input.preheader,
    greetingName: "team",
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">${eyebrow}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        A new website submission just came in. Details are below — reply directly to the lead using the email in this message.
      </p>
      ${detailBlock}
    `,
  });

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
