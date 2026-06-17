import { geminiGenerateJson } from "./gemini-client";
import {
  geminiGenerateJsonWithParts,
  type GeminiContentPart,
} from "./gemini-multimodal";

export type InventoryScanLine = {
  itemName: string;
  count: number;
  inventoryItemId: string;
  isNew?: boolean;
};

export type InventoryScanResponse = {
  extractedItems: InventoryScanLine[];
};

function parseDataUri(
  dataUri: string,
): { mimeType: string; base64: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri.trim());
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

function attachIds(
  rows: { itemName: string; count: number }[],
  catalog: { id: string; name: string; category: string }[],
): InventoryScanLine[] {
  const lower = (s: string) => s.toLowerCase().trim();
  return rows.map((row) => {
    const hit = catalog.find((c) => lower(c.name) === lower(row.itemName));
    if (hit) {
      return {
        itemName: hit.name,
        count: Math.max(0, Math.round(row.count)),
        inventoryItemId: hit.id,
        isNew: false,
      };
    }
    return {
      itemName: row.itemName,
      count: Math.max(0, Math.round(row.count)),
      inventoryItemId: "",
      isNew: true,
    };
  });
}

export class InventoryScanService {
  static async extractFromText(params: {
    inventoryText: string;
    catalog: { id: string; name: string; category: string }[];
  }): Promise<InventoryScanResponse> {
    const { inventoryText, catalog } = params;
    const system =
      "You match informal stock notes to a master SKU list. Return JSON { \"extractedItems\": " +
      "[{ \"itemName\": string (exact from list when possible), \"count\": number }] } only. " +
      "Ignore items not in the catalog.";

    const user = `catalog=${JSON.stringify(catalog)}\nnotes:\n"""${inventoryText}"""`;

    const fallback: InventoryScanResponse = { extractedItems: [] };
    const raw = await geminiGenerateJson<{
      extractedItems?: { itemName?: string; count?: number }[];
    }>({
      system,
      user,
      fallback,
      maxOutputTokens: 2048,
    });

    const rows = Array.isArray(raw.extractedItems) ? raw.extractedItems : [];
    const cleaned = rows
      .filter(
        (r) =>
          r && typeof r.itemName === "string" && typeof r.count === "number",
      )
      .map((r) => ({
        itemName: String(r.itemName),
        count: Number(r.count) || 0,
      }));

    return { extractedItems: attachIds(cleaned, catalog) };
  }

  static async extractFromImage(params: {
    inventoryImageDataUri: string;
    catalog: { id: string; name: string; category: string }[];
  }): Promise<InventoryScanResponse> {
    const { inventoryImageDataUri, catalog } = params;
    const parsed = parseDataUri(inventoryImageDataUri);
    if (!parsed) return { extractedItems: [] };

    const system =
      "You count visible inventory units in a station photo. " +
      "Only count SKUs from the provided catalog. " +
      "Return JSON { \"extractedItems\": [{ \"itemName\": string (must match catalog name), " +
      "\"count\": number }] }.";

    const parts: GeminiContentPart[] = [
      {
        text: `catalog=${JSON.stringify(catalog)}\nAnalyze the attached image.`,
      },
      { inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } },
    ];

    const fallback: InventoryScanResponse = { extractedItems: [] };
    const raw = await geminiGenerateJsonWithParts<{
      extractedItems?: { itemName?: string; count?: number }[];
    }>({
      system,
      parts,
      fallback,
      maxOutputTokens: 2048,
    });

    const rows = Array.isArray(raw.extractedItems) ? raw.extractedItems : [];
    const cleaned = rows
      .filter(
        (r) =>
          r && typeof r.itemName === "string" && typeof r.count === "number",
      )
      .map((r) => ({
        itemName: String(r.itemName),
        count: Number(r.count) || 0,
      }));

    return { extractedItems: attachIds(cleaned, catalog) };
  }
}
