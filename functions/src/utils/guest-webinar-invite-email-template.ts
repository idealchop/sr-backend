import { escapeHtmlForEmail } from "./auth-transactional-email";
import { webinarEmailActionButtonsHtml } from "./webinar-email-cta";
import {
  buildSmartRefillEmailFooterPlainText,
  smartRefillEmailWhenHtml,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

export type GuestWebinarInviteEmailInput = {
  displayName: string;
  eventName: string;
  startsAtLabel: string;
  timezone: string;
  joinUrl: string;
  cancelUrl: string;
  feedbackUrl?: string;
  requiresApproval: boolean;
};

/** Guest invite after public webinar registration. */
export function buildGuestWebinarInviteEmail(
  input: GuestWebinarInviteEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const subject = input.requiresApproval ?
    `Registration received: ${eventName}` :
    `You're registered: ${eventName}`;

  const statusLine = input.requiresApproval ?
    "Your registration is pending approval. When accepted, use the button below to join during the live window." :
    "You are confirmed. Join when the session is live using the button below.";

  const html = wrapSmartRefillLetterHtml({
    title: eventName,
    headline: eventName,
    greetingName: name,
    includeSignOff: false,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        ${escapeHtmlForEmail(statusLine)}
      </p>
      ${smartRefillEmailWhenHtml(input.startsAtLabel, input.timezone)}
      ${input.feedbackUrl ?
        webinarEmailActionButtonsHtml({
          primaryUrl: input.joinUrl,
          primaryLabel: "Join webinar",
          feedbackUrl: input.feedbackUrl,
        }) :
        ""}
      <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5e6c84;">
        Join opens about 30 minutes before start. Keep this email — the link is personal to your registration.
      </p>
      <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#5e6c84;">
        Need to cancel? <a href="${escapeHtmlForEmail(input.cancelUrl)}" style="color:#0052cc;">Cancel registration</a>
      </p>
    `,
    cta: input.feedbackUrl ? null : { label: "Join webinar", url: input.joinUrl },
  });

  const text = [
    subject,
    "",
    `Hi ${name},`,
    statusLine,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    "",
    `Join: ${input.joinUrl}`,
    input.feedbackUrl ? `Rate & feedback: ${input.feedbackUrl}` : "",
    "",
    `Cancel: ${input.cancelUrl}`,
  ].filter(Boolean).join("\n") + "\n\n" + buildSmartRefillEmailFooterPlainText();

  return {
    subject,
    html,
    text,
    brevoTag: "guest_webinar_invite",
  };
}

export type GuestWebinarReminderEmailInput = {
  displayName: string;
  eventName: string;
  startsAtLabel: string;
  timezone: string;
  joinUrl: string;
  cancelUrl: string;
  feedbackUrl?: string;
};

/** T-1h reminder for opted-in guests. */
export function buildGuestWebinarReminderEmail(
  input: GuestWebinarReminderEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const subject = `Starting soon: ${eventName}`;

  const html = wrapSmartRefillLetterHtml({
    title: subject,
    headline: `${eventName} starts in about an hour`,
    greetingName: name,
    includeSignOff: false,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        This is your reminder for today’s webinar.
      </p>
      ${smartRefillEmailWhenHtml(input.startsAtLabel, input.timezone)}
      ${input.feedbackUrl ?
        webinarEmailActionButtonsHtml({
          primaryUrl: input.joinUrl,
          primaryLabel: "Join webinar",
          feedbackUrl: input.feedbackUrl,
        }) :
        ""}
      <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5e6c84;">
        <a href="${escapeHtmlForEmail(input.cancelUrl)}" style="color:#0052cc;">Cancel registration</a>
      </p>
    `,
    cta: input.feedbackUrl ? null : { label: "Join webinar", url: input.joinUrl },
  });

  const text = [
    subject,
    "",
    `Hi ${name},`,
    `${eventName} starts in about an hour.`,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    "",
    `Join: ${input.joinUrl}`,
    input.feedbackUrl ? `Rate & feedback: ${input.feedbackUrl}` : "",
    `Cancel: ${input.cancelUrl}`,
  ].filter(Boolean).join("\n") + "\n\n" + buildSmartRefillEmailFooterPlainText();

  return {
    subject,
    html,
    text,
    brevoTag: "guest_webinar_reminder",
  };
}
