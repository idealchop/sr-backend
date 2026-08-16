import { escapeHtmlForEmail } from "./auth-transactional-email";

export type GuestWebinarInviteEmailInput = {
  displayName: string;
  eventName: string;
  startsAtLabel: string;
  timezone: string;
  joinUrl: string;
  cancelUrl: string;
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

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Webinar invite</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(eventName)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(name)}, ${escapeHtmlForEmail(statusLine)}
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;color:#64748b;">When</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(input.startsAtLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Timezone: ${escapeHtmlForEmail(input.timezone)}</p>
    </div>
    <a href="${escapeHtmlForEmail(input.joinUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Join webinar</a>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
      Join opens about 30 minutes before start. Keep this email — the link is personal to your registration.
    </p>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
      Need to cancel? <a href="${escapeHtmlForEmail(input.cancelUrl)}" style="color:#64748b;">Cancel registration</a>
    </p>
  </div>
</body>
</html>`;

  const text = [
    subject,
    "",
    `Hi ${name},`,
    statusLine,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    "",
    `Join: ${input.joinUrl}`,
    "",
    `Cancel: ${input.cancelUrl}`,
  ].join("\n");

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
};

/** T-1h reminder for opted-in guests. */
export function buildGuestWebinarReminderEmail(
  input: GuestWebinarReminderEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const eventName = input.eventName.trim() || "Smart Refill webinar";
  const name = input.displayName.trim() || "there";
  const subject = `Starting soon: ${eventName}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Reminder</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${escapeHtmlForEmail(eventName)} starts in about an hour</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(name)}, this is your reminder for today’s webinar.
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:13px;color:#64748b;">When</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(input.startsAtLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Timezone: ${escapeHtmlForEmail(input.timezone)}</p>
    </div>
    <a href="${escapeHtmlForEmail(input.joinUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Join webinar</a>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
      <a href="${escapeHtmlForEmail(input.cancelUrl)}" style="color:#64748b;">Cancel registration</a>
    </p>
  </div>
</body>
</html>`;

  const text = [
    subject,
    "",
    `Hi ${name},`,
    `${eventName} starts in about an hour.`,
    "",
    `When: ${input.startsAtLabel} (${input.timezone})`,
    "",
    `Join: ${input.joinUrl}`,
    `Cancel: ${input.cancelUrl}`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    brevoTag: "guest_webinar_reminder",
  };
}
