import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { resolveVerifiedOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import { buildResourcesVideoPublishedOwnerEmail } from "../../utils/resources-video-published-owner-email-template";

export type SendResourcesVideoPublishedOwnerEmailParams = {
  businessId: string;
  businessData: Record<string, unknown>;
  videoName: string;
  videoId: string;
  category: "wrs_stories" | "webinar";
  reviewPath: string;
};

/**
 * Sends a one-shot owner email for a newly published Resources video.
 * Only owners with Firebase Auth `emailVerified` receive mail.
 * @return {Promise<boolean>} True when an email was accepted (or logged in emulator).
 */
export async function sendResourcesVideoPublishedOwnerEmail(
  params: SendResourcesVideoPublishedOwnerEmailParams,
): Promise<boolean> {
  const recipient = await resolveVerifiedOwnerEmailForBusiness(params.businessData);
  if (!recipient) {
    logger.info("resources video published owner email skipped — unverified or missing", {
      businessId: params.businessId,
      videoId: params.videoId,
    });
    return false;
  }

  const categoryLabel =
    params.category === "webinar" ? "Webinar recording" : "WRS Story";
  const watchUrl = `${resolveAppBaseUrlForEmail()}${params.reviewPath}`;
  const tpl = buildResourcesVideoPublishedOwnerEmail({
    ownerName: recipient.name,
    businessName: String(params.businessData.name || "Your station"),
    videoName: params.videoName,
    categoryLabel,
    watchUrl,
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: resources video published owner email", {
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
