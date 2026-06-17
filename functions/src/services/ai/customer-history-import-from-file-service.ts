import { logger } from "../observability/logging/logger";
import { geminiGenerateJson } from "./gemini-client";
import {
  geminiGenerateJsonWithParts,
  type GeminiContentPart,
} from "./gemini-multimodal";

export type CustomerHistoryTransactionType =
  | "delivery"
  | "walkin"
  | "collection"
  | "expense";

export type ExtractedCustomerHistoryRow = {
  date: string;
  transactionType: CustomerHistoryTransactionType;
  bottleQuantity?: number;
  amount?: number;
  paymentMethod?: "Cash" | "Online Payment" | "Not Paid";
  deliveryStatus?: "delivered" | "pending";
  paymentStatus?: "paid" | "partial" | "unpaid";
  notes?: string;
};

export type CustomerHistoryImportExtractResult = {
  transactions: ExtractedCustomerHistoryRow[];
  parseWarnings: string[];
};

const MAX_ROWS = 80;
const MAX_TEXT_CHARS = 120_000;

function parseDataUri(
  dataUri: string,
): { mimeType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mimeType: m[1].trim().toLowerCase(), base64: m[2] };
}

function decodeBase64ToUtf8(base64: string): string {
  try {
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

const VALID_TYPES = new Set<CustomerHistoryTransactionType>([
  "delivery",
  "walkin",
  "collection",
  "expense",
]);

function normalizeType(raw: unknown): CustomerHistoryTransactionType {
  const s = String(raw || "")
    .toLowerCase()
    .trim();
  if (s === "sale" || s === "deliver" || s === "delivery") return "delivery";
  if (s === "walk-in" || s === "walkin" || s === "walk_in" || s === "direct") {
    return "walkin";
  }
  if (s === "collect" || s === "collection" || s === "return") {
    return "collection";
  }
  if (s === "expense" || s === "vendor" || s === "purchase") return "expense";
  if (VALID_TYPES.has(s as CustomerHistoryTransactionType)) {
    return s as CustomerHistoryTransactionType;
  }
  return "delivery";
}

function normalizeRow(
  raw: Partial<ExtractedCustomerHistoryRow>,
  currentDate: string,
): ExtractedCustomerHistoryRow | null {
  const transactionType = normalizeType(raw.transactionType);
  const date =
    typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim()) ?
      raw.date.trim() :
      currentDate;
  const bottleQuantity =
    typeof raw.bottleQuantity === "number" &&
    Number.isFinite(raw.bottleQuantity) ?
      Math.max(0, Math.round(raw.bottleQuantity)) :
      undefined;
  const amount =
    typeof raw.amount === "number" && Number.isFinite(raw.amount) ?
      Math.max(0, Number(raw.amount)) :
      undefined;

  if (transactionType === "expense" && (!amount || amount <= 0)) return null;
  if (
    transactionType !== "expense" &&
    (!amount || amount <= 0) &&
    (!bottleQuantity || bottleQuantity <= 0)
  ) {
    return null;
  }

  return {
    date,
    transactionType,
    bottleQuantity,
    amount,
    paymentMethod: raw.paymentMethod,
    deliveryStatus: raw.deliveryStatus === "pending" ? "pending" : "delivered",
    paymentStatus: raw.paymentStatus,
    notes: raw.notes ? String(raw.notes).slice(0, 500) : undefined,
  };
}

const SCHEMA =
  "Return STRICT JSON: { \"transactions\": array (max " +
  MAX_ROWS +
  "), \"parseWarnings\": string[] }. " +
  "Each row maps to Firestore businesses/{id}/transactions fields used by import: " +
  "date (YYYY-MM-DD → scheduledAt), transactionType (delivery|walkin|collection|expense), " +
  "bottleQuantity (number, gallons/units for water rows), amount (number PHP → totalAmount), " +
  "paymentMethod (Cash|Online Payment|Not Paid → paymentMethod), " +
  "deliveryStatus (delivered|pending), paymentStatus (paid|partial|unpaid), " +
  "notes (optional string). All rows belong to ONE customer only — " +
  "do not include other customers. " +
  "Map ledger 'Sale' to delivery or walkin based on context. Skip header-only lines.";

export class CustomerHistoryImportFromFileService {
  static async extractFromDataUri(params: {
    fileDataUri: string;
    customerName: string;
    customerAddress?: string;
    currentDate: string;
  }): Promise<CustomerHistoryImportExtractResult> {
    const empty: CustomerHistoryImportExtractResult = {
      transactions: [],
      parseWarnings: [],
    };
    const { fileDataUri, customerName, customerAddress, currentDate } = params;
    const parsed = parseDataUri(fileDataUri);
    if (!parsed) {
      return {
        ...empty,
        parseWarnings: ["Invalid data URI (expected data:<mime>;base64,...)"],
      };
    }

    const { mimeType, base64 } = parsed;
    if (base64.length > 4_500_000) {
      return {
        ...empty,
        parseWarnings: ["File is too large. Try a file under about 3 MB."],
      };
    }

    const system =
      "You digitize fulfillment history for ONE water-refill customer (Philippines). " +
      SCHEMA +
      " Output only valid JSON. If nothing is importable, return transactions: [] " +
      "and explain in parseWarnings.";

    const customerCtx =
      `customerName=${JSON.stringify(customerName)}\n` +
      `customerAddress=${JSON.stringify(customerAddress || "")}\n` +
      `currentDate=${currentDate}\n`;

    const textLike =
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/csv" ||
      mimeType === "application/vnd.ms-excel";

    try {
      if (textLike) {
        const text = decodeBase64ToUtf8(base64).slice(0, MAX_TEXT_CHARS);
        if (!text.trim()) {
          return {
            ...empty,
            parseWarnings: ["Could not read text from this file."],
          };
        }
        const raw = await geminiGenerateJson<{
          transactions?: Partial<ExtractedCustomerHistoryRow>[];
          parseWarnings?: string[];
        }>({
          system,
          user: `${customerCtx}\nFILE CONTENT:\n"""${text}"""`,
          fallback: { transactions: [], parseWarnings: [] },
          maxOutputTokens: 4096,
        });
        return CustomerHistoryImportFromFileService.normalizeExtract(
          raw,
          currentDate,
        );
      }

      const parts: GeminiContentPart[] = [
        {
          text: `${customerCtx}\nExtract every history row for this customer only.`,
        },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ];
      const raw = await geminiGenerateJsonWithParts<{
        transactions?: Partial<ExtractedCustomerHistoryRow>[];
        parseWarnings?: string[];
      }>({
        system,
        parts,
        fallback: { transactions: [], parseWarnings: [] },
        maxOutputTokens: 4096,
      });
      return CustomerHistoryImportFromFileService.normalizeExtract(
        raw,
        currentDate,
      );
    } catch (e) {
      logger.error("CustomerHistoryImportFromFileService.extract", e);
      return {
        ...empty,
        parseWarnings: [
          "AI extraction failed. Try a clearer export or CSV template.",
        ],
      };
    }
  }

  private static normalizeExtract(
    raw: {
      transactions?: Partial<ExtractedCustomerHistoryRow>[];
      parseWarnings?: string[];
    },
    currentDate: string,
  ): CustomerHistoryImportExtractResult {
    const warnings = Array.isArray(raw.parseWarnings) ?
      raw.parseWarnings.map((w) => String(w)).filter(Boolean) :
      [];
    const txs = Array.isArray(raw.transactions) ? raw.transactions : [];
    const normalized: ExtractedCustomerHistoryRow[] = [];
    for (const t of txs.slice(0, MAX_ROWS)) {
      const row = normalizeRow(t || {}, currentDate);
      if (row) normalized.push(row);
    }
    if (!normalized.length && !warnings.length) {
      warnings.push("No importable history rows were found in this file.");
    }
    return { transactions: normalized, parseWarnings: warnings };
  }
}
