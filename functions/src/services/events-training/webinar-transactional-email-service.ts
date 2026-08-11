import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import {
  buildMemberWebinarConfirmationEmail,
  buildMemberWebinarReminderEmail,
  buildWebinarApprovedEmail,
} from "../../utils/webinar-transactional-email-templates";
import { webinarRegistrationsCollection, webinarsCollection } from "./events-training-collections";
import { mintJoinToken, hashJoinToken } from "./guest-webinar-registration-service";
import { sendGuestWebinarInviteEmail } from "./guest-webinar-invite-email-service";
import { toIsoTimestamp } from "./webinar-registration-window";

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

async function sendBrevo(opts: {
  email: string;
  name: string;
  subject: string;
  html: string;
  text: string;
  brevoTag: string;
  logLabel: string;
  meta?: Record<string, unknown>;
}): Promise<boolean> {
  const email = String(opts.email || "").trim().toLowerCase();
  if (!email) return false;

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info(`EMULATOR: ${opts.logLabel}`, {
      email,
      subject: opts.subject,
      ...(opts.meta || {}),
    });
    return true;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email, name: opts.name || email }];
  sendSmtpEmail.subject = opts.subject;
  sendSmtpEmail.htmlContent = opts.html;
  sendSmtpEmail.textContent = opts.text;
  sendSmtpEmail.tags = [opts.brevoTag];
  await api.sendTransacEmail(sendSmtpEmail);
  return true;
}

export async function sendMemberWebinarConfirmationEmail(input: {
  registrationId: string;
  email: string;
  displayName?: string | null;
  eventName: string;
  startsAt: string | null;
  timezone: string;
  requiresApproval: boolean;
}): Promise<boolean> {
  const email = String(input.email || "").trim().toLowerCase();
  if (!email) return false;

  const hubUrl = `${resolveAppBaseUrlForEmail()}/webinars`;
  const timezone = input.timezone.trim() || "Asia/Manila";
  const tpl = buildMemberWebinarConfirmationEmail({
    displayName: input.displayName || email,
    eventName: input.eventName,
    startsAtLabel: formatStartsAtLabel(input.startsAt, timezone),
    timezone,
    hubUrl,
    requiresApproval: input.requiresApproval,
  });

  const ok = await sendBrevo({
    email,
    name: input.displayName || email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    brevoTag: tpl.brevoTag,
    logLabel: "member webinar confirmation email",
    meta: { registrationId: input.registrationId },
  });
  if (!ok) return false;

  await webinarRegistrationsCollection().doc(input.registrationId).set(
    {
      confirmationSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

/**
 * Approval email for members or guests after ops accept.
 * Guests get a fresh join token + invite-style CTA.
 */
export async function sendWebinarApprovalEmail(input: {
  registrationId: string;
}): Promise<boolean> {
  const regRef = webinarRegistrationsCollection().doc(input.registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) return false;
  const reg = (regSnap.data() ?? {}) as Record<string, unknown>;
  if (reg.approvalSentAt) return false;

  const email = String(reg.email || "").trim().toLowerCase();
  if (!email) return false;

  const eventId = String(reg.eventId || "").trim();
  const eventSnap = eventId ? await webinarsCollection().doc(eventId).get() : null;
  const eventData = (eventSnap?.data() ?? {}) as Record<string, unknown>;
  const eventName = String(eventData.name ?? "").trim() || "Smart Refill webinar";
  const startsAt = toIsoTimestamp(eventData.startsAt);
  const timezone =
    typeof eventData.timezone === "string" && eventData.timezone.trim() ?
      eventData.timezone.trim() :
      "Asia/Manila";
  const kind = String(reg.kind || "member");
  const displayName =
    String(reg.displayName || "").trim() || email.split("@")[0] || email;

  if (kind === "guest") {
    const joinToken = mintJoinToken();
    await regRef.set(
      {
        joinTokenHash: hashJoinToken(joinToken),
        joinTokenCreatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const sent = await sendGuestWebinarInviteEmail({
      registrationId: input.registrationId,
      email,
      displayName,
      eventName,
      startsAt,
      timezone,
      joinToken,
      requiresApproval: false,
    });
    if (sent) {
      await regRef.set(
        {
          approvalSentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return sent;
  }

  const hubUrl = `${resolveAppBaseUrlForEmail()}/webinars`;
  const tpl = buildWebinarApprovedEmail({
    displayName,
    eventName,
    startsAtLabel: formatStartsAtLabel(startsAt, timezone),
    timezone,
    hubUrl,
  });
  const ok = await sendBrevo({
    email,
    name: displayName,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    brevoTag: tpl.brevoTag,
    logLabel: "member webinar approval email",
    meta: { registrationId: input.registrationId },
  });
  if (!ok) return false;

  await regRef.set(
    {
      approvalSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

export async function sendMemberWebinarReminderEmail(input: {
  registrationId: string;
  email: string;
  displayName?: string | null;
  eventName: string;
  startsAt: string | null;
  timezone: string;
}): Promise<boolean> {
  const email = String(input.email || "").trim().toLowerCase();
  if (!email) return false;

  const hubUrl = `${resolveAppBaseUrlForEmail()}/webinars`;
  const timezone = input.timezone.trim() || "Asia/Manila";
  const tpl = buildMemberWebinarReminderEmail({
    displayName: input.displayName || email,
    eventName: input.eventName,
    startsAtLabel: formatStartsAtLabel(input.startsAt, timezone),
    timezone,
    hubUrl,
  });

  const ok = await sendBrevo({
    email,
    name: input.displayName || email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    brevoTag: tpl.brevoTag,
    logLabel: "member webinar reminder email",
    meta: { registrationId: input.registrationId },
  });
  if (!ok) return false;

  await webinarRegistrationsCollection().doc(input.registrationId).set(
    {
      reminderSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

/** Best-effort: used by Sales Portal after accept (via SmartRefill ops hook). */
export async function notifyRegistrationApproved(
  registrationId: string,
): Promise<{ sent: boolean }> {
  try {
    const sent = await sendWebinarApprovalEmail({ registrationId });
    return { sent };
  } catch (err) {
    logger.warn("notifyRegistrationApproved failed", {
      registrationId,
      error: err,
    });
    return { sent: false };
  }
}
