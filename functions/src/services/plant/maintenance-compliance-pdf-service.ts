import PDFDocument from "pdfkit";
import type { MaintenanceTemplateRecord } from "./maintenance-template-types";
import type { WaterQualityLogRecord } from "./water-quality-log-service";

export type MaintenanceCompletionPdfRow = {
  templateName: string;
  completedAt: string;
  notes: string | null;
  proofUrl: string | null;
};

export type MaintenanceCompliancePdfInput = {
  businessName: string;
  periodDays: number;
  generatedAt: string;
  completions: MaintenanceCompletionPdfRow[];
  qualitySummary: {
    totalLogs: number;
    failedProductLogs: number;
    latestProductTds: number | null;
  };
  overdueTemplates: MaintenanceTemplateRecord[];
};

function resetCursor(doc: InstanceType<typeof PDFDocument>, margin: number): void {
  doc.opacity(1);
  doc.fillColor("#111827");
  doc.font("Helvetica");
  doc.x = margin;
  doc.y = margin;
}

/**
 * MP-15 — maintenance compliance export PDF.
 */
export function buildMaintenanceCompliancePdf(
  input: MaintenanceCompliancePdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 48,
        info: {
          Title: `${input.businessName} plant compliance`,
          Author: "Smart Refill",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const margin = 48;
      resetCursor(doc, margin);
      const width = doc.page.width - margin * 2;

      doc
        .fillColor("#0f766e")
        .fontSize(20)
        .font("Helvetica-Bold")
        .text("Plant maintenance compliance", margin, doc.y, { width });
      doc
        .fontSize(11)
        .fillColor("#374151")
        .font("Helvetica")
        .text(input.businessName, margin, doc.y, { width });
      doc
        .fontSize(9)
        .fillColor("#6b7280")
        .text(
          `Last ${input.periodDays} days · Generated ${input.generatedAt}`,
          margin,
          doc.y,
          { width },
        );
      doc.moveDown(1);

      doc.fontSize(12).fillColor("#111827").font("Helvetica-Bold").text("Summary");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(10);
      doc.text(`Completed PM tasks: ${input.completions.length}`);
      doc.text(`Water quality logs: ${input.qualitySummary.totalLogs}`);
      doc.text(`Failed product TDS logs: ${input.qualitySummary.failedProductLogs}`);
      if (input.qualitySummary.latestProductTds != null) {
        doc.text(`Latest product TDS: ${input.qualitySummary.latestProductTds} ppm`);
      }
      doc.text(`Overdue templates now: ${input.overdueTemplates.length}`);
      doc.moveDown(0.8);

      doc.font("Helvetica-Bold").fontSize(12).text("Completed maintenance");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9);
      if (!input.completions.length) {
        doc.text("No completed tasks in this period.");
      } else {
        for (const row of input.completions.slice(0, 40)) {
          doc
            .fillColor("#111827")
            .text(`${row.templateName} — ${row.completedAt.slice(0, 10)}`);
          if (row.notes) doc.fillColor("#6b7280").text(`Notes: ${row.notes}`);
          if (row.proofUrl) doc.text(`Proof: ${row.proofUrl}`);
          doc.moveDown(0.25);
        }
      }

      if (input.overdueTemplates.length) {
        doc.moveDown(0.6);
        doc.fillColor("#b91c1c").font("Helvetica-Bold").fontSize(12).text("Currently overdue");
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(9).fillColor("#111827");
        for (const template of input.overdueTemplates) {
          doc.text(`${template.name} (due ${template.nextDueAt})`);
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function summarizeQualityForCompliance(
  logs: WaterQualityLogRecord[],
): MaintenanceCompliancePdfInput["qualitySummary"] {
  const productLogs = logs.filter((log) => log.locationTag === "product");
  return {
    totalLogs: logs.length,
    failedProductLogs: productLogs.filter((log) => log.pass === false).length,
    latestProductTds: productLogs[0]?.tdsPpm ?? null,
  };
}
