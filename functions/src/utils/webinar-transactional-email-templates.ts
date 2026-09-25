import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  smartRefillEmailWhenHtml,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

export type WebinarTransactionalEmailInput = {
  displayName: string;
  eventName: string;
  startsAtLabel: string;
  timezone: string;
  hubUrl?: string | null;
  joinUrl?: string | null;
  cancelUrl?: string | null;
  requiresApproval?: boolean;
};

function shell(opts: {
  eyebrow: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string | null;
  footerHtml?: string;
}): string {
  return wrapSmartRefillLetterHtml({
    title: opts.title,
    headline: opts.title,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">${escapeHtmlForEmail(opts.eyebrow)}</p>
      ${opts.bodyHtml}
      ${opts.footerHtml || ""}
    `,
    cta:
      opts.ctaUrl && opts.ctaLabel ?
        { label: opts.ctaLabel, url: opts.ctaUrl } :
        null,
  });
}

export function buildMemberWebinarConfirmationEmail(
  input: WebinarTransactionalEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const pending = input.requiresApproval === true;
  const subject = pending ?
    `Registration received: ${eventName}` :
    `You're registered: ${eventName}`;
  const statusLine = pending ?
    "Your registration is pending approval. We'll email you when you're accepted." :
    "You are confirmed for this webinar.";

  const html = shell({
    eyebrow: "Webinar registration",
    title: eventName,
    bodyHtml: `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
      Hi ${escapeHtmlForEmail(name)}, ${escapeHtmlForEmail(statusLine)}
    </p>
    ${smartRefillEmailWhenHtml(input.startsAtLabel, input.timezone)}`,
    ctaLabel: "Open webinars hub",
    ctaUrl: input.hubUrl,
  });

  const text = [
    subject,
    "",
    `Hi ${name},`,
    statusLine,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    input.hubUrl ? `Hub: ${input.hubUrl}` : "",
  ].filter(Boolean).join("\n");

  return { subject, html, text, brevoTag: "member_webinar_confirm" };
}

export function buildWebinarApprovedEmail(
  input: WebinarTransactionalEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const subject = `You're approved: ${eventName}`;
  const joinHint = input.joinUrl ?
    "Use the button below to join during the live window." :
    "Open the webinars hub when the session starts to join.";

  const html = shell({
    eyebrow: "Registration approved",
    title: eventName,
    bodyHtml: `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
      Hi ${escapeHtmlForEmail(name)}, your registration was approved. ${escapeHtmlForEmail(joinHint)}
    </p>
    ${smartRefillEmailWhenHtml(input.startsAtLabel, input.timezone)}`,
    ctaLabel: input.joinUrl ? "Join webinar" : "Open webinars hub",
    ctaUrl: input.joinUrl || input.hubUrl,
    footerHtml: input.cancelUrl ?
      `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Need to cancel? <a href="${escapeHtmlForEmail(input.cancelUrl)}" style="color:#64748b;">Cancel registration</a></p>` :
      "",
  });

  const text = [
    subject,
    "",
    `Hi ${name}, your registration was approved.`,
    joinHint,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    input.joinUrl ? `Join: ${input.joinUrl}` : "",
    input.hubUrl ? `Hub: ${input.hubUrl}` : "",
  ].filter(Boolean).join("\n");

  return { subject, html, text, brevoTag: "webinar_approved" };
}

export function buildMemberWebinarReminderEmail(
  input: WebinarTransactionalEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const subject = `Starting soon: ${eventName}`;

  const html = shell({
    eyebrow: "Reminder",
    title: `${eventName} starts in about an hour`,
    bodyHtml: `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
      Hi ${escapeHtmlForEmail(name)}, this is your reminder for today’s webinar.
    </p>
    ${smartRefillEmailWhenHtml(input.startsAtLabel, input.timezone)}`,
    ctaLabel: "Open webinars hub",
    ctaUrl: input.hubUrl,
  });

  const text = [
    subject,
    "",
    `Hi ${name}, reminder — ${eventName} starts in about an hour.`,
    `When: ${input.startsAtLabel} (${input.timezone})`,
    input.hubUrl ? `Hub: ${input.hubUrl}` : "",
  ].filter(Boolean).join("\n");

  return { subject, html, text, brevoTag: "member_webinar_reminder" };
}
