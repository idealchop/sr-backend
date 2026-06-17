import { logger } from "../observability/logging/logger";
import { geminiGenerateJson } from "./gemini-client";
import {
  geminiGenerateJsonWithParts,
  type GeminiContentPart,
} from "./gemini-multimodal";

export type ExtractedInventoryDraft = {
  name: string;
  category: string;
  quantity?: number;
  unit?: string;
  minStockThreshold?: number;
  cost?: number;
  avgUsage?: number;
};

export type InventoryImportExtractResult = {
  items: ExtractedInventoryDraft[];
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

const SCHEMA =
  "Return STRICT JSON: { \"items\": array (max " +
  MAX_ROWS +
  "), \"parseWarnings\": string[] }. " +
  "Each item maps to Firestore businesses/{id}/inventory_items fields: " +
  "name (string, required), categoryId (string category label — map CSV column category), " +
  "stock.current (number, on-hand count; map quantity/qty/current), " +
  "stock.min (number, reorder minimum; map minStockThreshold/min_stock/reorder_level), " +
  "stock.unit (string, e.g. pcs, units, gallons), cost (number PHP unit cost, optional), " +
  "avgUsage (number, optional daily average). " +
  "Skip header-only rows.";

export class InventoryImportFromFileService {
  static async extractFromDataUri(
    fileDataUri: string,
  ): Promise<InventoryImportExtractResult> {
    const empty: InventoryImportExtractResult = {
      items: [],
      parseWarnings: [],
    };
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
      "You extract water-refill station inventory rows (containers, dispensers, supplies) " +
      "for the Philippines. " +
      SCHEMA +
      " Output only valid JSON. If no inventory rows, return items: [] " +
      "and explain in parseWarnings.";

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
          items?: ExtractedInventoryDraft[];
          parseWarnings?: string[];
        }>({
          system,
          user: `MIME:${mimeType}\n\nFILE_CONTENT:\n"""${text}"""`,
          fallback: { items: [], parseWarnings: [] },
          maxOutputTokens: 8192,
        });
        return normalizeExtract(raw);
      }

      const parts: GeminiContentPart[] = [
        {
          text: `MIME:${mimeType}. Extract inventory item rows from this file.`,
        },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ];
      const raw = await geminiGenerateJsonWithParts<{
        items?: ExtractedInventoryDraft[];
        parseWarnings?: string[];
      }>({
        system,
        parts,
        fallback: { items: [], parseWarnings: [] },
        maxOutputTokens: 8192,
      });
      return normalizeExtract(raw);
    } catch (e) {
      logger.error("InventoryImportFromFileService.extractFromDataUri", e);
      return {
        ...empty,
        parseWarnings: ["Import preview failed. Try CSV or a clearer export."],
      };
    }
  }
}

function normalizeExtract(raw: {
  items?: ExtractedInventoryDraft[];
  parseWarnings?: string[];
}): InventoryImportExtractResult {
  const warnings = Array.isArray(raw.parseWarnings) ?
    raw.parseWarnings
      .filter((w): w is string => typeof w === "string")
      .map((w) => w.trim())
      .filter(Boolean) :
    [];
  const rows = Array.isArray(raw.items) ? raw.items : [];
  const items: ExtractedInventoryDraft[] = [];
  const seenNames = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name || "").trim();
    const category = String(row.category || "").trim();
    if (!name || !category) continue;

    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const quantity =
      typeof row.quantity === "number" && Number.isFinite(row.quantity) ?
        Math.max(0, row.quantity) :
        0;
    const minStockThreshold =
      typeof row.minStockThreshold === "number" &&
      Number.isFinite(row.minStockThreshold) ?
        Math.max(0, row.minStockThreshold) :
        0;
    const cost =
      typeof row.cost === "number" && Number.isFinite(row.cost) ?
        Math.max(0, row.cost) :
        0;
    const avgUsage =
      typeof row.avgUsage === "number" && Number.isFinite(row.avgUsage) ?
        Math.max(0, row.avgUsage) :
        undefined;

    items.push({
      name,
      category,
      quantity,
      unit: String(row.unit || "pcs").trim() || "pcs",
      minStockThreshold,
      cost,
      avgUsage,
    });
    if (items.length >= MAX_ROWS) break;
  }

  if (!items.length && !warnings.length) {
    warnings.push("No valid rows with name and category were found.");
  }

  return { items, parseWarnings: warnings };
}
