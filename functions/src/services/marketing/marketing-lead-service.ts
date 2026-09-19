import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { brevo, getBrevoApi } from "../../utils/brevo";
import {
  getInquiryLeadEmail,
  getPartnerApplicationLeadEmail,
  getRequestDemoConfirmEmail,
  getRequestDemoLeadEmail,
} from "../../utils/marketing-lead-email-templates";
import {
  DEMO_ADDITIONAL_INVITEES,
  DEMO_DURATION_MINUTES,
  DEMO_PRESENTER_EMAIL,
  DEMO_TIMEZONE,
} from "./demo-calendar-config";
import { createDemoMeetEvent } from "./demo-calendar-service";
import { buildDemoRequestIcs } from "./demo-ics";

type LeadEmailTemplate = {
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
};

function supportRecipient(): { email: string; name: string } {
  const email =
    process.env.SUPPORT_EMAIL?.trim() || DEMO_PRESENTER_EMAIL;
  return { email, name: "Smart Refill Support" };
}

async function sendMarketingEmail(opts: {
  template: LeadEmailTemplate;
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  attachment?: Array<{ name: string; content: string }>;
}): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: Marketing lead email", {
      subject: opts.template.subject,
      tag: opts.template.brevoTag,
      to: opts.to.map((r) => r.email),
      cc: opts.cc?.map((r) => r.email) ?? [],
      hasAttachment: Boolean(opts.attachment?.length),
    });
    return;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();

  sendSmtpEmail.subject = opts.template.subject;
  sendSmtpEmail.htmlContent = opts.template.html;
  sendSmtpEmail.textContent = opts.template.text;
  sendSmtpEmail.sender = {
    name: "Smart Refill",
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = opts.to.map((r) => ({
    email: r.email,
    name: r.name,
  }));
  if (opts.cc?.length) {
    sendSmtpEmail.cc = opts.cc.map((r) => ({
      email: r.email,
      name: r.name,
    }));
  }
  sendSmtpEmail.tags = [opts.template.brevoTag];
  if (opts.attachment?.length) {
    sendSmtpEmail.attachment = opts.attachment.map((a) => ({
      name: a.name,
      content: a.content,
      ...(a.name.toLowerCase().endsWith(".ics") ?
        { contentType: "text/calendar; method=REQUEST" } :
        {}),
    }));
  }

  await api.sendTransacEmail(sendSmtpEmail);
  logger.info("Marketing lead email sent", {
    subject: opts.template.subject,
    tag: opts.template.brevoTag,
  });
}

/** Legacy helper for inquiry / partner leads (support inbox only). */
async function sendLeadEmail(template: LeadEmailTemplate): Promise<void> {
  await sendMarketingEmail({
    template,
    to: [supportRecipient()],
  });
}

async function persistInquiry(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.collection("inquiries").add({
    type,
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function submitRequestDemoLead(data: {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  stationCount?: string;
  requestedDate?: string;
  requestedTime?: string;
}): Promise<void> {
  const meet = await createDemoMeetEvent(data);
  const icsUid = `demo-${meet.eventId || Date.now()}@smartrefill.io`;
  const icsBody = buildDemoRequestIcs({
    uid: icsUid,
    slot: meet.slot,
    businessName: data.businessName,
    inquireeName: data.name,
    inquireeEmail: data.email,
    meetLink: meet.meetLink,
  });
  const icsAttachment = {
    name: "smart-refill-demo.ics",
    content: Buffer.from(icsBody, "utf8").toString("base64"),
  };

  const emailCtx = {
    ...data,
    demoSlotLabel: meet.slotLabel,
    meetLink: meet.meetLink,
  };

  const teamTemplate = getRequestDemoLeadEmail(emailCtx);
  const confirmTemplate = getRequestDemoConfirmEmail(emailCtx);

  const support = supportRecipient();
  const teamCc = [
    ...DEMO_ADDITIONAL_INVITEES.map((email) => ({ email })),
  ].filter(
    (r) => r.email.toLowerCase() !== support.email.toLowerCase(),
  );

  await sendMarketingEmail({
    template: teamTemplate,
    to: [{ email: DEMO_PRESENTER_EMAIL, name: "Smart Refill Support" }],
    cc: teamCc,
    attachment: [icsAttachment],
  });

  const inquireeEmail = data.email.trim().toLowerCase();
  if (inquireeEmail.includes("@")) {
    await sendMarketingEmail({
      template: confirmTemplate,
      to: [{ email: inquireeEmail, name: data.name.trim() || undefined }],
      attachment: [icsAttachment],
    });
  }

  await persistInquiry("request_demo", {
    ...data,
    demoStartsAt: meet.slot.startsAtIso,
    demoEndsAt: meet.slot.endsAtIso,
    demoDurationMinutes: DEMO_DURATION_MINUTES,
    demoTimezone: DEMO_TIMEZONE,
    demoSlotLabel: meet.slotLabel,
    meetLink: meet.meetLink,
    calendarEventId: meet.eventId,
  });
}

export async function submitInquiryLead(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  businessAddress: string;
  message: string;
}): Promise<void> {
  const template = getInquiryLeadEmail(data);
  await sendLeadEmail(template);
  await persistInquiry("collaboration", data);
}

export async function submitPartnerApplicationLead(data: {
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
}): Promise<void> {
  const template = getPartnerApplicationLeadEmail(data);
  await sendLeadEmail(template);
  await persistInquiry("partner_application", data);
}
