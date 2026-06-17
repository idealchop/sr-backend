import { logger } from "../observability/logging/logger";
import { geminiGenerateJson } from "./gemini-client";
import {
  geminiGenerateJsonWithParts,
  type GeminiContentPart,
} from "./gemini-multimodal";
import { isValidCustomerMapCoordinate } from "../customers/customer-location";
import { enrichCustomerDraftsWithGeocoding } from "../customers/customer-address-geocode";

export type ExtractedCustomerDraft = {
  name: string;
  phone: string;
  address: string;
  email?: string;
  type?: "residential" | "commercial";
  companyName?: string;
  latitude?: number;
  longitude?: number;
  isDeliveryEnabled?: boolean;
  isCollectionEnabled?: boolean;
};

export type CustomerImportExtractResult = {
  customers: ExtractedCustomerDraft[];
  parseWarnings: string[];
  geocodedCount?: number;
  geocodeWarnings?: string[];
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
  "Return STRICT JSON: { \"customers\": array (max " +
  MAX_ROWS +
  "), \"parseWarnings\": string[] }. " +
  "Each customer maps to Firestore businesses/{id}/customers fields: " +
  "name (string, required), phone (string, required — digits ok with + or spaces), " +
  "address (string, required — full street/area in Philippines), " +
  "email (optional), type (\"residential\"|\"commercial\", default residential), " +
  "companyName (optional, commercial only), " +
  "latitude (number, optional), longitude (number, optional — omit both when unknown; " +
  "never use 0,0), isDeliveryEnabled (boolean, default true), " +
  "isCollectionEnabled (boolean, default false). " +
  "Map CSV headers name, phone, address, email, type, company_name, latitude, longitude, " +
  "is_delivery_enabled, is_collection_enabled. Skip header-only rows. " +
  "Deduplicate obvious duplicates by phone.";

export class CustomerImportFromFileService {
  // eslint-disable-next-line valid-jsdoc
  /**
   * Uses Gemini to extract customer rows from an arbitrary uploaded file (image, pdf, spreadsheet,
     csv, text).
   */
  static async extractFromDataUri(
    fileDataUri: string,
  ): Promise<CustomerImportExtractResult> {
    const empty: CustomerImportExtractResult = {
      customers: [],
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
      "You extract water-refill station (suki) customer records for a business " +
      "in the Philippines. " +
      SCHEMA +
      " Output only valid JSON. If the file has no identifiable customers, return customers: [] " +
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
        const user = `MIME:${mimeType}\n\nFILE_CONTENT:\n"""${text}"""`;
        const raw = await geminiGenerateJson<{
          customers?: ExtractedCustomerDraft[];
          parseWarnings?: string[];
        }>({
          system,
          user,
          fallback: { customers: [], parseWarnings: [] },
          maxOutputTokens: 8192,
        });
        return CustomerImportFromFileService.finalizeExtract(raw);
      }

      const parts: GeminiContentPart[] = [
        { text: `MIME:${mimeType}. Extract customer records from this file.` },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ];
      const raw = await geminiGenerateJsonWithParts<{
        customers?: ExtractedCustomerDraft[];
        parseWarnings?: string[];
      }>({
        system,
        parts,
        fallback: { customers: [], parseWarnings: [] },
        maxOutputTokens: 8192,
      });
      return CustomerImportFromFileService.finalizeExtract(raw);
    } catch (e) {
      logger.error("CustomerImportFromFileService.extractFromDataUri", e);
      return {
        ...empty,
        parseWarnings: ["Import preview failed. Try CSV or a clearer export."],
      };
    }
  }

  private static async finalizeExtract(raw: {
    customers?: ExtractedCustomerDraft[];
    parseWarnings?: string[];
  }): Promise<CustomerImportExtractResult> {
    const normalized = normalizeExtract(raw);
    const geocoded = await enrichCustomerDraftsWithGeocoding(normalized.customers);
    return {
      customers: geocoded.rows,
      parseWarnings: [
        ...normalized.parseWarnings,
        ...geocoded.geocodeWarnings,
      ],
      geocodedCount: geocoded.geocodedCount,
      geocodeWarnings: geocoded.geocodeWarnings.length ?
        geocoded.geocodeWarnings :
        undefined,
    };
  }
}

function normalizeExtract(raw: {
  customers?: ExtractedCustomerDraft[];
  parseWarnings?: string[];
}): CustomerImportExtractResult {
  const warnings = Array.isArray(raw.parseWarnings) ?
    raw.parseWarnings
      .filter((w): w is string => typeof w === "string")
      .map((w) => w.trim())
      .filter(Boolean) :
    [];
  const rows = Array.isArray(raw.customers) ? raw.customers : [];
  const customers: ExtractedCustomerDraft[] = [];
  const seenPhones = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as ExtractedCustomerDraft).name || "").trim();
    const phone = String((row as ExtractedCustomerDraft).phone || "")
      .replace(/\s+/g, " ")
      .trim();
    const address = String(
      (row as ExtractedCustomerDraft).address || "",
    ).trim();
    if (!name || !phone || !address) continue;
    const key = phone.replace(/\D/g, "").slice(-10);
    if (key.length >= 8 && seenPhones.has(key)) continue;
    if (key.length >= 8) seenPhones.add(key);

    const type =
      (row as ExtractedCustomerDraft).type === "commercial" ?
        "commercial" :
        "residential";
    const lat =
      typeof (row as ExtractedCustomerDraft).latitude === "number" ?
        (row as ExtractedCustomerDraft).latitude :
        undefined;
    const lng =
      typeof (row as ExtractedCustomerDraft).longitude === "number" ?
        (row as ExtractedCustomerDraft).longitude :
        undefined;
    const hasCoords = isValidCustomerMapCoordinate(lat, lng);

    customers.push({
      name,
      phone,
      address,
      email: (row as ExtractedCustomerDraft).email ?
        String((row as ExtractedCustomerDraft).email).trim() :
        undefined,
      type,
      companyName: (row as ExtractedCustomerDraft).companyName ?
        String((row as ExtractedCustomerDraft).companyName).trim() :
        undefined,
      latitude: hasCoords ? lat : undefined,
      longitude: hasCoords ? lng : undefined,
      isDeliveryEnabled:
        (row as ExtractedCustomerDraft).isDeliveryEnabled !== false,
      isCollectionEnabled: !!(row as ExtractedCustomerDraft)
        .isCollectionEnabled,
    });
    if (customers.length >= MAX_ROWS) break;
  }

  if (!customers.length && !warnings.length) {
    warnings.push("No valid rows with name, phone, and address were found.");
  }

  return { customers, parseWarnings: warnings };
}
