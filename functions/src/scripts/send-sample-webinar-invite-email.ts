/**
 * Sends a sample guest webinar invite (Join + ratings/feedback buttons) via Brevo.
 *
 * Usage:
 *   cd backend/functions && npx ts-node src/scripts/send-sample-webinar-invite-email.ts you@example.com
 *
 * Uses SMARTREFILL_BREVO_API_KEY from functions/.env. Does not apply the Dev
 * outbound sink so the intended inbox receives the sample.
 */
import { loadLocalEnvIfNeeded } from "../config/load-local-env";
import * as brevo from "@getbrevo/brevo";
import { buildGuestWebinarInviteEmail } from "../utils/guest-webinar-invite-email-template";

loadLocalEnvIfNeeded();

async function main(): Promise<void> {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email.includes("@")) {
    throw new Error("Pass a recipient email: npx ts-node src/scripts/send-sample-webinar-invite-email.ts you@example.com");
  }

  const apiKey = process.env.SMARTREFILL_BREVO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SMARTREFILL_BREVO_API_KEY is missing in functions/.env");
  }

  const origin = "https://smartrefill.io";
  const tpl = buildGuestWebinarInviteEmail({
    displayName: "Justfer",
    eventName: "Smart Refill webinar (sample)",
    startsAtLabel: "Fri, Sep 18, 2026, 2:00 PM",
    timezone: "Asia/Manila",
    joinUrl: `${origin}/resources/webinars`,
    cancelUrl: `${origin}/resources/webinars`,
    feedbackUrl: `${origin}/resources/webinars/feedback?event=sample-webinar`,
    requiresApproval: false,
  });

  const api = new brevo.TransactionalEmailsApi();
  api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email, name: "Justfer" }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag, "webinar_feedback_sample"];
  await api.sendTransacEmail(sendSmtpEmail);
  console.log(`Sent sample webinar invite to ${email}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
