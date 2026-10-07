import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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

  const html = wrapSmartRefillLetterHtml({
    title: "New video ready to watch",
    headline: "New video ready to watch",
    greetingName: input.ownerName,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6c84;">${escapeHtmlForEmail(categoryLabel)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        A new Smart Refill video is available for ${escapeHtmlForEmail(input.businessName)}.
      </p>
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#172b4d;">${escapeHtmlForEmail(videoName)}</p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5e6c84;">Open Resources to watch it on your station dashboard.</p>
    `,
    cta: { label: "Watch video", url: input.watchUrl },
  });

  const text = [
    "New video ready to watch",
    "",
    `Hi ${input.ownerName},`,
    `${videoName} is now available for ${input.businessName}.`,
    "",
    `Watch: ${input.watchUrl}`,
    "",
    buildSmartRefillEmailFooterPlainText(),
  ].join("\n");

  return {
    subject,
    html,
    text,
    brevoTag: "resources_video_published_owner_email",
  };
}
