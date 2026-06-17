import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { brevo, getBrevoApi } from "../../utils/brevo";
import {
  getInquiryLeadEmail,
  getPartnerApplicationLeadEmail,
  getRequestDemoLeadEmail,
} from "../../utils/marketing-lead-email-templates";

function supportRecipient(): { email: string; name: string } {
  const email =
    process.env.SUPPORT_EMAIL?.trim() || "support@riverph.com";
  return { email, name: "Smart Refill Support" };
}

async function sendLeadEmail(
  template: ReturnType<typeof getRequestDemoLeadEmail>,
): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: Marketing lead email", {
      subject: template.subject,
      tag: template.brevoTag,
    });
    return;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  const to = supportRecipient();

  sendSmtpEmail.subject = template.subject;
  sendSmtpEmail.htmlContent = template.html;
  sendSmtpEmail.textContent = template.text;
  sendSmtpEmail.sender = {
    name: "Smart Refill",
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email: to.email, name: to.name }];
  sendSmtpEmail.tags = [template.brevoTag];

  await api.sendTransacEmail(sendSmtpEmail);
  logger.info("Marketing lead email sent", { subject: template.subject });
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
}): Promise<void> {
  const template = getRequestDemoLeadEmail(data);
  await sendLeadEmail(template);
  await persistInquiry("request_demo", data);
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
