import PDFDocument from "pdfkit";

export interface SubscriptionInvoicePdfInput {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  ownerDisplayName: string;
  ownerEmail: string;
  subscriptionId: string;
  planName: string;
  planCode: string;
  billingCycle: string;
  price: number;
  paymentMethod: string;
  paymentReference: string;
  paymentStatus: string;
  voucherCode: string;
  periodStart: string;
  periodEnd: string;
  renewalDate: string;
}

/**
 * Turns `businesses.location`, `address`, or nested maps into a single readable line
 * (avoids `[object Object]` when Firestore stores a map or GeoPoint).
 * @param {unknown} v Raw field value.
 * @param {number} depth Recursion guard for nested objects.
 * @return {string} Human-readable address or empty string.
 */
function formatLocationLikeValue(v: unknown, depth = 0): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "object" || depth > 5) return "";

  const o = v as Record<string, unknown>;

  if (typeof o.toDate === "function") return "";

  const lat = o.latitude ?? o._latitude;
  const lng = o.longitude ?? o._longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    return `${lat}, ${lng}`;
  }

  const stringKeys = [
    "formatted",
    "formattedAddress",
    "label",
    "fullAddress",
    "text",
    "displayName",
    "street",
    "line1",
    "line2",
    "addressLine1",
    "addressLine2",
    "barangay",
    "municipality",
    "city",
    "province",
    "region",
    "postalCode",
    "zipCode",
    "zip",
    "country",
    "details",
    "name",
    "address",
  ];
  const parts: string[] = [];
  for (const k of stringKeys) {
    const s = o[k];
    if (typeof s === "string" && s.trim()) parts.push(s.trim());
  }
  if (parts.length) return [...new Set(parts)].join(", ");

  const nested: string[] = [];
  for (const val of Object.values(o)) {
    if (typeof val === "string" && val.trim()) nested.push(val.trim());
    else if (typeof val === "object" && val !== null) {
      const inner = formatLocationLikeValue(val, depth + 1);
      if (inner) nested.push(inner);
    }
  }
  if (nested.length) return [...new Set(nested)].join(", ");

  return "";
}

/**
 * Resolves a printable street / location line from a business document.
 * @param {Record<string, unknown>} biz Firestore `businesses` data.
 * @return {string} Single-line address for receipts.
 */
export function formatBusinessAddressForPdf(
  biz: Record<string, unknown>,
): string {
  const a = formatLocationLikeValue(biz.location);
  if (a) return a;
  const b = formatLocationLikeValue(biz.address);
  if (b) return b;
  const c =
    typeof biz.stationAddress === "string" ?
      biz.stationAddress.trim() :
      formatLocationLikeValue(biz.stationAddress);
  return c || "";
}

// eslint-disable-next-line valid-jsdoc
/**
 * Faint diagonal watermark behind receipt content.
 * @param {InstanceType<typeof PDFDocument>} doc The PDF document.
 */
function drawReceiptWatermark(doc: InstanceType<typeof PDFDocument>): void {
  const w = doc.page.width;
  const h = doc.page.height;
  doc.save();
  doc.translate(w / 2, h / 2);
  doc.rotate(-34);
  doc.opacity(0.065);
  doc.fillColor("#0f766e");
  doc.font("Helvetica-Bold").fontSize(56);
  doc.text("SMART REFILL", -220, -28, { width: 440, align: "center" });
  doc.font("Helvetica").fontSize(13);
  doc.opacity(0.045);
  doc.fillColor("#0f766e");
  doc.text("Official subscription receipt", -220, 28, {
    width: 440,
    align: "center",
  });
  doc.restore();
}

// eslint-disable-next-line valid-jsdoc
/**
 * PDFKit leaves `doc.x` / `doc.y` in user space after transformed `text()` calls.
 * Reset cursor + ink so body content is not drawn off-page.
 * @param {InstanceType<typeof PDFDocument>} doc The PDF document.
 * @param {number} fallbackMargin Default margin when `page.margins` is missing.
 */
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

/**
 * Renders a subscription payment receipt as a PDF (A4).
 * @param {SubscriptionInvoicePdfInput} input The subscription invoice data.
 * @return {Promise<Buffer>} The PDF buffer.
 */
export function buildSubscriptionInvoicePdf(
  input: SubscriptionInvoicePdfInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 48,
        info: {
          Title: "Smart Refill subscription receipt",
          Author: "Smart Refill",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      drawReceiptWatermark(doc);

      const margin =
        typeof doc.page.margins?.left === "number" ? doc.page.margins.left : 48;
      resetPageLayoutCursor(doc, margin);

      const money = input.price.toLocaleString("en-PH", {
        maximumFractionDigits: 2,
      });
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
        .text("Smart Refill", margin, doc.y, { width: contentWidth });
      doc
        .fillColor("#374151")
        .fontSize(11)
        .font("Helvetica")
        .text("Subscription payment receipt", margin, doc.y, {
          width: contentWidth,
        });
      doc.moveDown(0.45);
      doc
        .fontSize(8)
        .fillColor("#9ca3af")
        .text(
          "River Tech Inc. · SEC Reg. 2025080215620-07 · BF Homes, 410 El Grande Ave, " +
            "Parañaque, 1720 Metro Manila, PH",
          margin,
          doc.y,
          { width: contentWidth, align: "left" },
        );
      doc.moveDown(1.1);

      section("Business");
      row("Business name", input.businessName);
      row("Business email", input.businessEmail);
      row("Phone", input.businessPhone);
      row("Address", input.businessAddress);

      section("Account owner");
      row("Name", input.ownerDisplayName);
      row("Email", input.ownerEmail);

      section("Subscription");
      row("Reference (Firestore)", input.subscriptionId);
      row("Plan", `${input.planName} (${input.planCode})`);
      row("Billing cycle", input.billingCycle);
      row("Service period start", input.periodStart);
      row("Service period end", input.periodEnd);
      row("Renewal / next cycle", input.renewalDate);
      row("Payment status", input.paymentStatus);
      row("Payment method", input.paymentMethod || "—");
      row("Payment reference", input.paymentReference || "—");
      if (input.voucherCode) {
        row("Voucher", input.voucherCode);
      }

      section("Amount");
      doc
        .fontSize(14)
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .text(`PHP ${money}`, margin, doc.y, {
          width: contentWidth,
          align: "left",
        });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6b7280")
        .text("Amount recorded for this subscription period.", margin, doc.y, {
          width: contentWidth,
        });

      doc.moveDown(1.8);
      doc
        .fontSize(8)
        .fillColor("#9ca3af")
        .text(
          "This document summarizes the subscription record on file. " +
            "For tax or accounting advice, consult your professional.",
          margin,
          doc.y,
          { align: "left", width: contentWidth },
        );
      doc.moveDown(0.9);
      doc
        .fontSize(8)
        .fillColor("#94a3b8")
        .font("Helvetica")
        .text("Powered by River Tech Inc.", margin, doc.y, {
          align: "center",
          width: contentWidth,
        });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
