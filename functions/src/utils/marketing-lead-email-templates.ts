/* eslint-disable max-len */
import {
  escapeHtmlForEmail,
} from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  SMART_REFILL_BRAND_TEAL,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

const BRAND_COLOR = SMART_REFILL_BRAND_TEAL;

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

export type RequestDemoEmailContext = {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  stationCount?: string;
  requestedDate?: string;
  requestedTime?: string;
  demoSlotLabel?: string;
  meetLink?: string | null;
};

export function getRequestDemoLeadEmail(data: RequestDemoEmailContext) {
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
      row("Preferred time", data.requestedTime ?? "—"),
      row("Scheduled slot", data.demoSlotLabel ?? "—"),
      row("Google Meet", data.meetLink?.trim() || "Pending — calendar invite follows"),
    ],
  });
}

/**
 * Confirmation email to the inquiree after Request a Demo.
 * @param {RequestDemoEmailContext} data Lead + schedule context.
 * @return {Object} Compiled Brevo email payload.
 */
export function getRequestDemoConfirmEmail(data: RequestDemoEmailContext): {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
} {
  const name = data.name.trim() || "there";
  const business = data.businessName.trim() || "your station";
  const slot = data.demoSlotLabel ?? "to be confirmed";
  const meetRaw = data.meetLink?.trim() || "";
  const meetHtml = meetRaw ?
    `<a href="${escapeHtmlForEmail(meetRaw)}" style="color:${BRAND_COLOR};font-weight:600;">${escapeHtmlForEmail(meetRaw)}</a>` :
    "A Google Meet link will be shared with your calendar invite shortly.";
  const meetPlain = meetRaw || "A Google Meet link will be shared with your calendar invite shortly.";

  const subject = `Your Smart Refill demo is scheduled — ${data.businessName.trim() || "WRS"}`;
  const text =
    `Hi ${name},\n\n` +
    `Thanks for requesting a Smart Refill demo for ${business}.\n\n` +
    `When: ${slot}\n` +
    "Duration: 1 hour\n" +
    `Google Meet: ${meetPlain}\n\n` +
    "We've also invited our team. A calendar invite (.ics) is attached.\n\n" +
    `${buildSmartRefillEmailFooterPlainText()}`;

  const html = wrapSmartRefillLetterHtml({
    title: subject,
    headline: "You're booked for a 1-hour demo",
    preheader: "Your 1-hour Smart Refill demo details",
    greetingName: name,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">Demo confirmation</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        Thanks for requesting a demo for <strong>${escapeHtmlForEmail(business)}</strong>. Here are your details:
      </p>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.65;color:#253858;">
        <strong style="display:block;margin:0 0 4px;font-size:13px;font-weight:600;color:#5e6c84;">When</strong>
        ${escapeHtmlForEmail(slot)}
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#253858;">
        <strong style="display:block;margin:0 0 4px;font-size:13px;font-weight:600;color:#5e6c84;">Duration</strong>
        1 hour
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#253858;">
        <strong style="display:block;margin:0 0 4px;font-size:13px;font-weight:600;color:#5e6c84;">Google Meet</strong>
        ${meetHtml}
      </p>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#5e6c84;">
        A calendar invite (.ics) is attached. Our team will join from the Smart Refill calendar invite.
      </p>
    `,
  });

  return {
    subject,
    html,
    text,
    brevoTag: "marketing-request-demo-confirm",
  };
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
