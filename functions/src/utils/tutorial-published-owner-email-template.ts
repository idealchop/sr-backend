import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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

  const html = wrapSmartRefillLetterHtml({
    title: "New tutorial ready to watch",
    headline: "New tutorial ready to watch",
    greetingName: input.ownerName,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#253858;">
        A new Smart Refill tutorial is available for ${escapeHtmlForEmail(input.businessName)}.
      </p>
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#172b4d;">${escapeHtmlForEmail(tutorialName)}</p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5e6c84;">Open Tutorial videos in your dashboard to follow along while you work.</p>
    `,
    cta: { label: "Watch tutorial", url: input.watchUrl },
  });

  const text = [
    "New tutorial ready to watch",
    "",
    `Hi ${input.ownerName},`,
    `${tutorialName} is now available for ${input.businessName}.`,
    "",
    `Watch: ${input.watchUrl}`,
    "",
    buildSmartRefillEmailFooterPlainText(),
  ].join("\n");

  return { subject, html, text, brevoTag: "tutorial_published_owner_email" };
}
