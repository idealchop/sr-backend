import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";

export type ExpenseScanDraft = {
  vendor?: string;
  amountPhp?: number;
  date?: string;
  category?: string;
  confidence: number;
};

/** AI-09 — expense receipt OCR stub (multimodal). */
export async function scanExpenseReceipt(params: {
  imageDataUri: string;
}): Promise<ExpenseScanDraft> {
  if (!getGeminiApiKey()) {
    return { confidence: 0 };
  }
  const system =
    "Extract supplier receipt fields for a WRS expense. JSON: vendor, amountPhp, date (YYYY-MM-DD), " +
    "category guess, confidence 0-1.";
  const raw = await geminiGenerateJson<ExpenseScanDraft>({
    system,
    user: `Receipt image data URI length: ${params.imageDataUri.length}`,
    fallback: { confidence: 0 },
  });
  return {
    vendor: typeof raw?.vendor === "string" ? raw.vendor : undefined,
    amountPhp: Number(raw?.amountPhp) || undefined,
    date: typeof raw?.date === "string" ? raw.date : undefined,
    category: typeof raw?.category === "string" ? raw.category : undefined,
    confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || 0)),
  };
}
