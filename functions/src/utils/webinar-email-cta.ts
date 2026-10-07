import { escapeHtmlForEmail } from "./auth-transactional-email";

export function buildWebinarFeedbackPath(input: {
  token?: string | null;
  eventId?: string | null;
}): string {
  const params = new URLSearchParams();
  const token = String(input.token || "").trim();
  const eventId = String(input.eventId || "").trim();
  if (token) params.set("t", token);
  if (eventId) params.set("event", eventId);
  const query = params.toString();
  return query ?
    `/resources/webinars/feedback?${query}` :
    "/resources/webinars/feedback";
}

export function webinarEmailActionButtonsHtml(input: {
  primaryUrl: string;
  primaryLabel: string;
  feedbackUrl: string;
}): string {
  const primary = `<a href="${escapeHtmlForEmail(input.primaryUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">${escapeHtmlForEmail(input.primaryLabel)}</a>`;
  const feedback = `<a href="${escapeHtmlForEmail(input.feedbackUrl)}" style="display:inline-block;background:#ffffff;color:#0f766e;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:12px;border:2px solid #44c1ba;">Provide ratings and feedback</a>`;
  return `<div style="margin:0 0 16px;">${primary}<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>${feedback}</div>`;
}
