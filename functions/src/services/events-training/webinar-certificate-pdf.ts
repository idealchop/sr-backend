import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  buildCertificateSvg,
  formatCertificateIssueDate,
} from "./certificate-template";

const SMARTREFILL_APP_ID = "smartrefill";
const SMARTREFILL_APP_LABEL = "smartrefill";
/** Same default mark Sales Portal uses for SmartRefill app branding. */
export const SMARTREFILL_CERTIFICATE_LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/smartrefill-singapore/o/Brand%20Logo%2FAsset%2022.png?alt=media&token=f7458efe-afd7-4006-862e-40c8d524c080";

/** Landscape A4 in points — hosts the rendered River credential art. */
const PAGE_W = 842;
const PAGE_H = 595;

export type WebinarCertificatePdfInput = {
  recipientName: string;
  title: string;
  speaker: string;
  eventStartsAt: string | null;
  issuedAt: string;
  certificateId: string;
  /** Optional app logo override (HTTPS or data URL). */
  logoUrl?: string | null;
  logoDataUrl?: string | null;
};

/**
 * Builds a landscape PDF that matches the Sales Portal River credential
 * preview (SVG → PNG embedded full-bleed).
 */
export async function buildWebinarCertificatePdf(
  input: WebinarCertificatePdfInput,
): Promise<Buffer> {
  const recipientName = input.recipientName.trim() || "Station member";
  const title = input.title.trim() || "Webinar";
  const speaker = input.speaker.trim();
  const eventDateLabel = input.eventStartsAt ?
    formatCertificateIssueDate(new Date(input.eventStartsAt)) :
    formatCertificateIssueDate(new Date(input.issuedAt));
  const issuedAtLabel = formatCertificateIssueDate(new Date(input.issuedAt));

  const svg = await buildCertificateSvg({
    appLabel: SMARTREFILL_APP_LABEL,
    appId: SMARTREFILL_APP_ID,
    recipientName,
    courseName: title,
    speaker: speaker || undefined,
    eventDateLabel,
    issuedAtLabel,
    certId: input.certificateId,
    logoUrl: input.logoUrl ?? SMARTREFILL_CERTIFICATE_LOGO_URL,
    logoDataUrl: input.logoDataUrl,
  });

  const png = await sharp(Buffer.from(svg, "utf8"))
    .resize(PAGE_W * 2, PAGE_H * 2, { fit: "fill" })
    .png()
    .toBuffer();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [PAGE_W, PAGE_H],
        margin: 0,
        info: {
          Title: `Certificate — ${title}`,
          Author: "Smart Refill",
          Subject: "Webinar Certificate of Completion",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.image(png, 0, 0, { width: PAGE_W, height: PAGE_H });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function webinarCertificateFilename(title: string, eventId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `webinar-certificate-${slug || eventId}.pdf`;
}
