import { escapeHtmlForEmail } from "./auth-transactional-email";

export type TutorialPublishedOwnerEmailInput = {
  ownerName: string;
  businessName: string;
  tutorialName: string;
  watchUrl: string;
};

/** Owner email when Sales Portal publishes a new SmartRefill tutorial video. */
export function buildTutorialPublishedOwnerEmail(
  input: TutorialPublishedOwnerEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const tutorialName = input.tutorialName.trim() || "Untitled tutorial";
  const subject = `New tutorial: ${tutorialName}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Tutorial videos</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">New tutorial ready to watch</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(input.ownerName)}, a new Smart Refill tutorial is available for ${escapeHtmlForEmail(input.businessName)}.
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(tutorialName)}</p>
      <p style="margin:8px 0 0;font-size:13px;line-height:1.45;color:#64748b;">Open Tutorial videos in your dashboard to follow along while you work.</p>
    </div>
    <a href="${escapeHtmlForEmail(input.watchUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Watch tutorial</a>
  </div>
</body>
</html>`;

  const text = [
    "New tutorial ready to watch",
    "",
    `Hi ${input.ownerName},`,
    `${tutorialName} is now available for ${input.businessName}.`,
    "",
    `Watch: ${input.watchUrl}`,
  ].join("\n");

  return { subject, html, text, brevoTag: "tutorial_published_owner_email" };
}
