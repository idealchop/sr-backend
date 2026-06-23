import PDFDocument from "pdfkit";
import { formatBusinessAddressForPdf } from "../subscriptions/subscription-invoice-pdf";

export interface PortalCompletionReceiptPdfInput {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  referenceId: string;
  transactionType: string;
  deliveryStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  riderName?: string;
  completedAt: string;
  lineItems: string[];
}

function drawReceiptWatermark(
  doc: InstanceType<typeof PDFDocument>,
  businessName: string,
): void {
  const w = doc.page.width;
  const h = doc.page.height;
  const label = businessName.trim().slice(0, 28).toUpperCase() || "RECEIPT";
  doc.save();
  doc.translate(w / 2, h / 2);
  doc.rotate(-34);
  doc.opacity(0.065);
  doc.fillColor("#0f766e");
  doc.font("Helvetica-Bold").fontSize(42);
  doc.text(label, -220, -28, { width: 440, align: "center" });
  doc.font("Helvetica").fontSize(13);
  doc.opacity(0.045);
  doc.text("Official order receipt", -220, 28, { width: 440, align: "center" });
  doc.restore();
}

function resetPageLayoutCursor(
  doc: InstanceType<typeof PDFDocument>,
  fallbackMargin: number,
): void {
  const m = doc.page.margins;
  const left = typeof m?.left === "number" ? m.left : fallbackMargin;
  const top = typeof m?.top === "number" ? m.top : fallbackMargin;
  doc.opacity(1);
  doc.fillColor("#111827");
  doc.strokeColor("#000000");
  doc.lineWidth(1);
  doc.font("Helvetica");
  doc.x = left;
  doc.y = top;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

/**
 * Renders a portal order completion receipt (A4 PDF).
 * @param {PortalCompletionReceiptPdfInput} input Receipt content.
 * @return {Promise<Buffer>} PDF bytes.
 */
export function buildPortalCompletionReceiptPdf(
  input: PortalCompletionReceiptPdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 48,
        info: {
          Title: `${input.businessName} order receipt ${input.referenceId}`,
          Author: input.businessName,
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      drawReceiptWatermark(doc, input.businessName);

      const margin =
        typeof doc.page.margins?.left === "number" ? doc.page.margins.left : 48;
      resetPageLayoutCursor(doc, margin);
      const contentWidth = doc.page.width - margin * 2;

      const section = (title: string) => {
        doc.moveDown(0.55);
        doc
          .fillColor("#0f766e")
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(title.toUpperCase(), margin, doc.y, { width: contentWidth });
        const lineY = doc.y + 2;
        doc
          .strokeColor("#e2e8f0")
          .lineWidth(0.5)
          .moveTo(margin, lineY)
          .lineTo(doc.page.width - margin, lineY)
          .stroke();
        doc.moveDown(0.45);
        doc.fillColor("#111827").font("Helvetica");
      };

      const row = (label: string, value: string) => {
        const rowTop = doc.y;
        doc
          .fontSize(9)
          .fillColor("#6b7280")
          .font("Helvetica")
          .text(`${label}: `, margin, rowTop, {
            continued: true,
            width: contentWidth,
          });
        doc
          .fillColor("#111827")
          .font("Helvetica-Bold")
          .text(value || "—");
        doc.font("Helvetica");
        doc.moveDown(0.22);
      };

      doc
        .fillColor("#0f766e")
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(input.businessName, margin, doc.y, { width: contentWidth });
      doc
        .fillColor("#374151")
        .fontSize(11)
        .font("Helvetica")
        .text("Order completion receipt", margin, doc.y, { width: contentWidth });
      doc.moveDown(1.1);

      section("Business");
      row("Name", input.businessName);
      row("Email", input.businessEmail);
      row("Phone", input.businessPhone);
      row("Address", input.businessAddress);

      section("Customer");
      row("Name", input.customerName);
      row("Email", input.customerEmail);
      row("Phone", input.customerPhone);
      row("Address", input.customerAddress);

      section("Order");
      row("Reference", input.referenceId);
      row("Type", input.transactionType);
      row("Status", input.deliveryStatus);
      row("Completed", input.completedAt);
      if (input.riderName) {
        row("Rider", input.riderName);
      }

      section("Items");
      for (const line of input.lineItems) {
        doc
          .fontSize(9)
          .fillColor("#111827")
          .text(`• ${line}`, margin, doc.y, { width: contentWidth });
        doc.moveDown(0.18);
      }

      section("Payment");
      row("Method", input.paymentMethod);
      row("Payment status", input.paymentStatus);
      doc.moveDown(0.15);
      doc
        .fontSize(14)
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .text(`Total: PHP ${formatMoney(input.totalAmount)}`, margin, doc.y, {
          width: contentWidth,
        });
      doc.moveDown(0.12);
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor("#374151")
        .text(`Amount paid: PHP ${formatMoney(input.amountPaid)}`, margin, doc.y, {
          width: contentWidth,
        });
      if (input.balanceDue > 0) {
        doc.moveDown(0.08);
        doc.text(`Balance due: PHP ${formatMoney(input.balanceDue)}`, margin, doc.y, {
          width: contentWidth,
        });
      }

      doc.moveDown(1.6);
      doc
        .fontSize(8)
        .fillColor("#9ca3af")
        .text(
          "This receipt confirms that your order was completed and recorded by the station. " +
            "Keep this document for your records.",
          margin,
          doc.y,
          { align: "left", width: contentWidth },
        );
      doc.moveDown(0.9);
      doc
        .fontSize(8)
        .fillColor("#94a3b8")
        .font("Helvetica-Bold")
        .text(input.businessName, margin, doc.y, {
          align: "center",
          width: contentWidth,
        });
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#94a3b8")
        .text("Powered by Smart Refill", margin, doc.y + 2, {
          align: "center",
          width: contentWidth,
        });
      doc.text("River Tech Inc. · https://riverph.com/", margin, doc.y + 2, {
        align: "center",
        width: contentWidth,
      });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export { formatBusinessAddressForPdf };
