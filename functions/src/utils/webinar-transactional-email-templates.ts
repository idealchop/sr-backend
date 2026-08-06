import { escapeHtmlForEmail } from "./auth-transactional-email";

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
  const cta =
    opts.ctaUrl && opts.ctaLabel ?
      `<a href="${escapeHtmlForEmail(opts.ctaUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">${escapeHtmlForEmail(opts.ctaLabel)}</a>` :
      "";
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtmlForEmail(opts.eyebrow)}</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(opts.title)}</h1>
    ${opts.bodyHtml}
    ${cta}
    ${opts.footerHtml || ""}
  </div>
</body>
</html>`;
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
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(name)}, ${escapeHtmlForEmail(statusLine)}
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;color:#64748b;">When</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(input.startsAtLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Timezone: ${escapeHtmlForEmail(input.timezone)}</p>
    </div>`,
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
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(name)}, your registration was approved. ${escapeHtmlForEmail(joinHint)}
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;color:#64748b;">When</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(input.startsAtLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Timezone: ${escapeHtmlForEmail(input.timezone)}</p>
    </div>`,
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
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(name)}, this is your reminder for today’s webinar.
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;color:#64748b;">When</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(input.startsAtLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Timezone: ${escapeHtmlForEmail(input.timezone)}</p>
    </div>`,
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
