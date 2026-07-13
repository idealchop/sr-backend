import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { resolveVerifiedOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import { buildTutorialPublishedOwnerEmail } from "../../utils/tutorial-published-owner-email-template";

export type SendTutorialPublishedOwnerEmailParams = {
  businessId: string;
  businessData: Record<string, unknown>;
  tutorialName: string;
  videoId: string;
};

/**
 * Sends a one-shot owner email for a newly published tutorial video.
 * Only owners with Firebase Auth `emailVerified` receive mail.
 * @return {Promise<boolean>} True when an email was accepted (or logged in emulator).
 */
export async function sendTutorialPublishedOwnerEmail(
  params: SendTutorialPublishedOwnerEmailParams,
): Promise<boolean> {
  const recipient = await resolveVerifiedOwnerEmailForBusiness(params.businessData);
  if (!recipient) {
    logger.info("tutorial published owner email skipped — unverified or missing", {
      businessId: params.businessId,
      videoId: params.videoId,
    });
    return false;
  }

  const watchUrl =
    `${resolveAppBaseUrlForEmail()}/dashboard?tutorial=${encodeURIComponent(params.videoId)}`;
  const tpl = buildTutorialPublishedOwnerEmail({
    ownerName: recipient.name,
    businessName: String(params.businessData.name || "Your station"),
    tutorialName: params.tutorialName,
    watchUrl,
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: tutorial published owner email", {
      businessId: params.businessId,
      email: recipient.email,
      videoId: params.videoId,
      subject: tpl.subject,
    });
    return true;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email: recipient.email, name: recipient.name }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];
  await api.sendTransacEmail(sendSmtpEmail);
  return true;
}
