import { geminiGenerateJson } from "./gemini-client";
import {
  geminiGenerateJsonWithParts,
  type GeminiContentPart,
} from "./gemini-multimodal";
import type { Customer } from "../customers/customer-service";
import { matchCustomersToLedgerRows } from "./ledger-scan-customer-match";
import {
  attachInventoryIds,
  LEDGER_TX_SCHEMA_HINT,
  normalizeLedgerRow,
} from "./ledger-scan-normalize";
import type {
  ExtractedLedgerInventoryLine,
  ExtractedLedgerResponse,
  ExtractedLedgerRow,
} from "./ledger-scan-types";

export type {
  ExtractedLedgerInventoryLine,
  ExtractedLedgerResponse,
  ExtractedLedgerRow,
  LedgerTransactionType,
} from "./ledger-scan-types";

function parseDataUri(
  dataUri: string,
): { mimeType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

function normalizeExtract(params: {
  raw: {
    transactions?: Partial<ExtractedLedgerRow>[];
    inventoryLines?: { itemName?: string; count?: number }[];
    parseWarnings?: string[];
  };
  currentDate: string;
  customers: Customer[];
  catalog: { id: string; name: string; category: string }[];
}): ExtractedLedgerResponse {
  const { raw, currentDate, customers, catalog } = params;
  const warnings = Array.isArray(raw.parseWarnings) ?
    raw.parseWarnings.map((w) => String(w)).filter(Boolean) :
    [];
  const txs = Array.isArray(raw.transactions) ? raw.transactions : [];
  const normalized: ExtractedLedgerRow[] = [];
  for (const t of txs.slice(0, 120)) {
    const row = normalizeLedgerRow(t || {}, currentDate);
    if (row) normalized.push(row);
  }

  const plain = customers.map((c) => ({
    id: c.id || "",
    name: c.name,
    phone: c.phone || "",
    address: c.address || "",
  }));
  const matched = matchCustomersToLedgerRows(normalized, plain);

  const invRaw = Array.isArray(raw.inventoryLines) ? raw.inventoryLines : [];
  const invCleaned = invRaw
    .filter(
      (r) =>
        r && typeof r.itemName === "string" && typeof r.count === "number",
    )
    .map((r) => ({
      itemName: String(r.itemName),
      count: Number(r.count) || 0,
    }));
  const inventoryLines: ExtractedLedgerInventoryLine[] = attachInventoryIds(
    invCleaned,
    catalog,
  );

  if (!matched.length && !inventoryLines.length && !warnings.length) {
    warnings.push("No importable ledger rows were found.");
  }

  return {
    transactions: matched,
    inventoryLines: inventoryLines.length ? inventoryLines : undefined,
    parseWarnings: warnings.length ? warnings : undefined,
  };
}

function buildContext(params: {
  currentDate: string;
  tomorrowDate: string;
  customers: Customer[];
  catalog: { id: string; name: string; category: string }[];
}): string {
  const plain = params.customers.map((c) => ({
    id: c.id || "",
    name: c.name,
    phone: c.phone || "",
    address: c.address || "",
  }));
  return (
    `currentDate=${params.currentDate}\n` +
    `tomorrowDate=${params.tomorrowDate}\n` +
    `knownCustomers=${JSON.stringify(plain)}\n` +
    `inventoryCatalog=${JSON.stringify(params.catalog)}\n`
  );
}

export class LedgerScanService {
  static async extractFromText(params: {
    ledgerText: string;
    currentDate: string;
    tomorrowDate: string;
    customers: Customer[];
    catalog: { id: string; name: string; category: string }[];
  }): Promise<ExtractedLedgerResponse> {
    const { ledgerText, currentDate, tomorrowDate, customers, catalog } = params;

    const system =
      "You digitize water station logbooks for the Philippines. " +
      LEDGER_TX_SCHEMA_HINT +
      " Match customerName/customerPhone to knownCustomers when possible — do not invent " +
      "duplicate names for the same person. Use currentDate when a line has no date. " +
      "Extract delivery, walk-in sales, container collections, expenses, and stock counts " +
      "when present.";

    const user =
      buildContext({ currentDate, tomorrowDate, customers, catalog }) +
      `\nNOTES:\n"""${ledgerText}"""`;

    const fallback: ExtractedLedgerResponse = { transactions: [] };
    const raw = await geminiGenerateJson<{
      transactions?: Partial<ExtractedLedgerRow>[];
      inventoryLines?: { itemName?: string; count?: number }[];
      parseWarnings?: string[];
    }>({
      system,
      user,
      fallback,
      maxOutputTokens: 4096,
    });

    return normalizeExtract({
      raw,
      currentDate,
      customers,
      catalog,
    });
  }

  static async extractFromImage(params: {
    ledgerImageDataUri: string;
    currentDate: string;
    tomorrowDate: string;
    customers: Customer[];
    catalog: { id: string; name: string; category: string }[];
  }): Promise<ExtractedLedgerResponse> {
    const {
      ledgerImageDataUri,
      currentDate,
      tomorrowDate,
      customers,
      catalog,
    } = params;
    const parsed = parseDataUri(ledgerImageDataUri);
    if (!parsed) {
      return {
        transactions: [],
        parseWarnings: ["Invalid image data URI."],
      };
    }

    const system =
      "You read handwritten or printed ledgers and receipts for water refilling stations. " +
      LEDGER_TX_SCHEMA_HINT +
      " Match customers to knownCustomers by name or phone. Use currentDate when no date " +
      "is legible.";

    const parts: GeminiContentPart[] = [
      {
        text:
          buildContext({ currentDate, tomorrowDate, customers, catalog }) +
          "\nTranscribe every legible transaction, collection, expense, and stock line.",
      },
      {
        inline_data: {
          mime_type: parsed.mimeType,
          data: parsed.base64,
        },
      },
    ];

    const fallback: ExtractedLedgerResponse = { transactions: [] };
    const raw = await geminiGenerateJsonWithParts<{
      transactions?: Partial<ExtractedLedgerRow>[];
      inventoryLines?: { itemName?: string; count?: number }[];
      parseWarnings?: string[];
    }>({
      system,
      parts,
      fallback,
      maxOutputTokens: 4096,
    });

    return normalizeExtract({
      raw,
      currentDate,
      customers,
      catalog,
    });
  }
}
