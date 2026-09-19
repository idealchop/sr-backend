/* eslint-disable max-len */
import {
  escapeHtmlForEmail,
  SMART_REFILL_EMAIL_LOGO_SRC,
} from "./auth-transactional-email";
import {
  buildSmartRefillEmailLegalFooterPlainText,
  buildSmartRefillEmailLegalFooterRowHtml,
} from "./smartrefill-email-legal-footer";

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
    `${buildSmartRefillEmailLegalFooterPlainText()}`;

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
              ${buildSmartRefillEmailLegalFooterRowHtml()}
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
  const name = escapeHtmlForEmail(data.name.trim() || "there");
  const business = escapeHtmlForEmail(data.businessName.trim() || "your station");
  const slot = escapeHtmlForEmail(data.demoSlotLabel ?? "to be confirmed");
  const meetRaw = data.meetLink?.trim() || "";
  const meetHtml = meetRaw ?
    `<a href="${escapeHtmlForEmail(meetRaw)}" style="color:${BRAND_COLOR};font-weight:600;">${escapeHtmlForEmail(meetRaw)}</a>` :
    "A Google Meet link will be shared with your calendar invite shortly.";
  const meetPlain = meetRaw || "A Google Meet link will be shared with your calendar invite shortly.";

  const subject = `Your Smart Refill demo is scheduled — ${data.businessName.trim() || "WRS"}`;
  const text =
    `Hi ${data.name.trim() || "there"},\n\n` +
    `Thanks for requesting a Smart Refill demo for ${data.businessName.trim() || "your station"}.\n\n` +
    `When: ${data.demoSlotLabel ?? "to be confirmed"}\n` +
    "Duration: 1 hour\n" +
    `Google Meet: ${meetPlain}\n\n` +
    "We've also invited our team. A calendar invite (.ics) is attached.\n\n" +
    `${buildSmartRefillEmailLegalFooterPlainText()}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlForEmail(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#e8eef4;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your 1-hour Smart Refill demo details</div>
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
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">Demo confirmation</p>
              <h1 style="margin:10px 0 0;font-size:18px;font-weight:700;color:#0f172a;">You're booked for a 1-hour demo</h1>
              <p style="margin:18px 0 0;font-size:14px;line-height:1.65;color:#475569;">
                Hi ${name}, thanks for requesting a demo for <strong>${business}</strong>.
                Here are your details:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                style="margin:26px 0 0;background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
                    <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">When</span><br />
                    <span style="font-size:13px;font-weight:600;color:#0f172a;">${slot}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
                    <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">Duration</span><br />
                    <span style="font-size:13px;font-weight:600;color:#0f172a;">1 hour</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;">
                    <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;">Google Meet</span><br />
                    <span style="font-size:13px;font-weight:600;color:#0f172a;">${meetHtml}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.65;color:#475569;">
                A calendar invite (.ics) is attached. Our team will join from the Smart Refill calendar invite.
              </p>
            </td>
          </tr>
              ${buildSmartRefillEmailLegalFooterRowHtml()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
