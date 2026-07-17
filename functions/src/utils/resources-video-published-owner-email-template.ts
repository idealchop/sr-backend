import { escapeHtmlForEmail } from "./auth-transactional-email";

export type ResourcesVideoPublishedOwnerEmailInput = {
  ownerName: string;
  businessName: string;
  videoName: string;
  categoryLabel: string;
  watchUrl: string;
};

/** Owner email when Sales Portal publishes a WRS Story or webinar recording. */
export function buildResourcesVideoPublishedOwnerEmail(
  input: ResourcesVideoPublishedOwnerEmailInput,
): { subject: string; html: string; text: string; brevoTag: string } {
  const videoName = input.videoName.trim() || "New video";
  const categoryLabel = input.categoryLabel.trim() || "Resources";
  const subject = `New ${categoryLabel.toLowerCase()}: ${videoName}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtmlForEmail(categoryLabel)}</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">New video ready to watch</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
      Hi ${escapeHtmlForEmail(input.ownerName)}, a new Smart Refill video is available for ${escapeHtmlForEmail(input.businessName)}.
    </p>
    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
      <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtmlForEmail(videoName)}</p>
      <p style="margin:8px 0 0;font-size:13px;line-height:1.45;color:#64748b;">Open Resources to watch it on your station dashboard.</p>
    </div>
    <a href="${escapeHtmlForEmail(input.watchUrl)}" style="display:inline-block;background:#44c1ba;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;">Watch video</a>
  </div>
</body>
</html>`;

  const text = [
    "New video ready to watch",
    "",
    `Hi ${input.ownerName},`,
    `${videoName} is now available for ${input.businessName}.`,
    "",
    `Watch: ${input.watchUrl}`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    brevoTag: "resources_video_published_owner_email",
  };
}
