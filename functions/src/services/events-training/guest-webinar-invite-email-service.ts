import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveMarketingSiteBaseUrl } from "../../utils/app-base-url";
import { buildGuestWebinarInviteEmail } from "../../utils/guest-webinar-invite-email-template";
import { webinarRegistrationsCollection } from "./events-training-collections";

export type SendGuestWebinarInviteParams = {
  registrationId: string;
  email: string;
  displayName: string;
  eventName: string;
  startsAt: string | null;
  timezone: string;
  joinToken: string;
  requiresApproval: boolean;
};

function formatStartsAtLabel(startsAt: string | null, timeZone: string): string {
  if (!startsAt) return "Schedule TBD";
  try {
    return new Date(startsAt).toLocaleString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "Asia/Manila",
    });
  } catch {
    return startsAt;
  }
}

/**
 * Sends guest invite email and stamps inviteSentAt on success.
 * @return {Promise<boolean>} True when accepted (or logged in emulator).
 */
export async function sendGuestWebinarInviteEmail(
  params: SendGuestWebinarInviteParams,
): Promise<boolean> {
  const email = String(params.email || "").trim().toLowerCase();
  const token = String(params.joinToken || "").trim();
  if (!email || !token) return false;

  const joinUrl =
    `${resolveMarketingSiteBaseUrl()}/resources/webinars/join?t=${encodeURIComponent(token)}`;
  const cancelUrl =
    `${resolveMarketingSiteBaseUrl()}/resources/webinars/cancel?t=${encodeURIComponent(token)}`;
  const timezone = params.timezone.trim() || "Asia/Manila";
  const tpl = buildGuestWebinarInviteEmail({
    displayName: params.displayName,
    eventName: params.eventName,
    startsAtLabel: formatStartsAtLabel(params.startsAt, timezone),
    timezone,
    joinUrl,
    cancelUrl,
    requiresApproval: params.requiresApproval,
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: guest webinar invite email", {
      email,
      registrationId: params.registrationId,
      subject: tpl.subject,
      joinUrl,
    });
  } else {
    const api = getBrevoApi();
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
    sendSmtpEmail.to = [{ email, name: params.displayName || email }];
    sendSmtpEmail.subject = tpl.subject;
    sendSmtpEmail.htmlContent = tpl.html;
    sendSmtpEmail.textContent = tpl.text;
    sendSmtpEmail.tags = [tpl.brevoTag];
    await api.sendTransacEmail(sendSmtpEmail);
  }

  await webinarRegistrationsCollection().doc(params.registrationId).set(
    {
      inviteSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}
