import { getGeminiApiKey } from "../ai/gemini-config";
import { geminiGenerateJson } from "../ai/gemini-client";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import { validateCommunityOrderFields } from "./community-dispatch-template-parser";

export type CommunityFreeTextParseResult = {
  fields: CommunityOrderFields;
  confidence: number;
  clarifyingQuestion?: string;
  source: "ai" | "fallback";
};

const FALLBACK: CommunityFreeTextParseResult = {
  fields: {},
  confidence: 0,
  clarifyingQuestion:
    "Salamat po! Paki-send ng name, qty (ilan galon), delivery o pickup, at mobile number para ma-process namin ang order.",
  source: "fallback",
};

function normalizeAiFields(raw: Record<string, unknown>): CommunityOrderFields {
  const deliveryRaw = raw.delivery;
  let delivery: boolean | undefined;
  if (typeof deliveryRaw === "boolean") {
    delivery = deliveryRaw;
  } else if (typeof deliveryRaw === "string") {
    const v = deliveryRaw.trim().toLowerCase();
    if (/^(yes|y|oo|deliver|delivery|padala|true)$/.test(v)) delivery = true;
    if (/^(no|n|hindi|pickup|false)$/.test(v)) delivery = false;
  }

  const qtyNum = Number(raw.qty);
  const qty =
    Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum) : undefined;

  return {
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : undefined,
    delivery,
    qty,
    preferredWaterType:
      typeof raw.preferredWaterType === "string" ?
        raw.preferredWaterType.trim().slice(0, 80) :
        undefined,
    location:
      typeof raw.location === "string" ? raw.location.trim().slice(0, 240) : undefined,
    email: typeof raw.email === "string" ? raw.email.trim().slice(0, 120) : undefined,
    number:
      typeof raw.number === "string" ? raw.number.trim().slice(0, 40) : undefined,
  };
}

/**
 * AI-04 — parse unstructured Messenger text into community order fields (platform intake).
 */
export async function parseCommunityFreeTextOrder(
  message: string,
): Promise<CommunityFreeTextParseResult> {
  const trimmed = message.trim().slice(0, 1200);
  if (!trimmed) return { ...FALLBACK };

  if (!getGeminiApiKey()) {
    return {
      ...FALLBACK,
      clarifyingQuestion:
        "Salamat po! Para sa order, paki-send: name, qty, delivery (yes/no), mobile number, at address kung delivery.",
    };
  }

  const system =
    "You parse Filipino/English free-text water refill orders for a community Facebook Page. " +
    "Customers order refilled water jugs (gallons). Output STRICT JSON with: " +
    "name (string), delivery (boolean — true if deliver/padala, false if pickup), " +
    "qty (integer gallons or jugs), " +
    "preferredWaterType (optional string e.g. alkaline, mineral, purified), " +
    "location (address/landmark if delivery), email (optional), number (mobile phone string), " +
    "confidence (0-1), clarifyingQuestion (short polite Taglish if confidence < 0.65 or required fields missing). " +
    "Extract numbers from phrases like '5 gal', 'limang galon', '3 containers'.";

  const raw = await geminiGenerateJson<{
    name?: string;
    delivery?: boolean | string;
    qty?: number;
    preferredWaterType?: string;
    location?: string;
    email?: string;
    number?: string;
    confidence?: number;
    clarifyingQuestion?: string;
  }>({
    system,
    user: `Message:\n${trimmed}`,
    fallback: {},
    temperature: 0.25,
  });

  const fields = normalizeAiFields(raw as Record<string, unknown>);
  const confidence = Math.min(1, Math.max(0, Number(raw?.confidence) || 0));
  const validationErrors = validateCommunityOrderFields(fields);
  const needsClarification = confidence < 0.65 || validationErrors.length > 0;

  return {
    fields,
    confidence,
    clarifyingQuestion: needsClarification ?
      (typeof raw?.clarifyingQuestion === "string" ?
        raw.clarifyingQuestion.trim().slice(0, 280) :
        FALLBACK.clarifyingQuestion) :
      undefined,
    source: "ai",
  };
}
