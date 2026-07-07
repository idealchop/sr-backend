import PDFDocument from "pdfkit";
import {
  buildDefaultContainerCustodySections,
  DEFAULT_CONTAINER_CUSTODY_VERSION,
} from "./container-custody-default-content";

export function buildDefaultContainerCustodyAgreementPdf(input: {
  stationName: string;
}): Promise<Buffer> {
  const stationName = input.stationName.trim() || "Water Refilling Station";
  const sections = buildDefaultContainerCustodySections(stationName);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 54,
        info: {
          Title: `${stationName} — Container custody agreement`,
          Author: stationName,
          Subject: `Container custody (${DEFAULT_CONTAINER_CUSTODY_VERSION})`,
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const contentWidth = doc.page.width - 108;

      doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f766e");
      doc.text("Container Custody Agreement", { width: contentWidth });
      doc.moveDown(0.35);
      doc.font("Helvetica").fontSize(11).fillColor("#374151");
      doc.text(stationName, { width: contentWidth });
      doc.moveDown(0.15);
      doc.fontSize(9).fillColor("#6b7280");
      doc.text(`Smart Refill standard template · ${DEFAULT_CONTAINER_CUSTODY_VERSION}`);
      doc.moveDown(0.8);

      for (const section of sections) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
        doc.text(section.title, { width: contentWidth });
        doc.moveDown(0.25);
        doc.font("Helvetica").fontSize(10).fillColor("#374151");
        for (const paragraph of section.paragraphs ?? []) {
          doc.text(paragraph, { width: contentWidth, align: "left" });
          doc.moveDown(0.35);
        }
        if (section.bullets?.length) {
          for (const bullet of section.bullets) {
            doc.text(`• ${bullet}`, {
              width: contentWidth,
              indent: 12,
              paragraphGap: 4,
            });
          }
          doc.moveDown(0.35);
        }
      }

      doc.moveDown(0.5);
      doc.fontSize(8).fillColor("#9ca3af");
      doc.text(
        "This template is provided by Smart Refill for operational clarity. " +
          "Stations may replace it with their own legal document. " +
          "Have local counsel review custom terms before use.",
        { width: contentWidth },
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
