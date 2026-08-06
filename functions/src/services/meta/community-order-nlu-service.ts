import { getGeminiApiKey } from "../ai/gemini-config";
import { geminiGenerateJson } from "../ai/gemini-client";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import { validateCommunityOrderFields } from "./community-dispatch-template-parser";

export type CommunityFreeTextParseResult = {
  fields: CommunityOrderFields;
  confidence: number;
  clarifyingQuestion?: string;
  source: "ai" | "fallback" | "local" | "rate_limited";
};

const FALLBACK: CommunityFreeTextParseResult = {
  fields: {},
  confidence: 0,
  clarifyingQuestion:
    "Salamat po! Paki-send ng name, qty (ilan galon), delivery o pickup, at mobile number para ma-process namin ang order.",
  source: "fallback",
};

/** Best-effort per-PSID Gemini NLU budget (per function instance). */
const NLU_AI_WINDOW_MS = 60 * 60 * 1000;
const NLU_AI_MAX_PER_WINDOW = 8;
const nluAiWindows = new Map<string, { windowStart: number; count: number }>();

export function resetCommunityNluRateLimitForTests(): void {
  nluAiWindows.clear();
}

function tryConsumeNluAiSlot(psid: string | undefined): boolean {
  const key = (psid || "").trim();
  if (!key) return true;
  const now = Date.now();
  const current = nluAiWindows.get(key);
  if (!current || now - current.windowStart > NLU_AI_WINDOW_MS) {
    nluAiWindows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (current.count >= NLU_AI_MAX_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function normalizeAiFields(
  raw: Record<string, unknown> | null | undefined,
): CommunityOrderFields {
  const src = raw ?? {};
  const deliveryRaw = src.delivery;
  let delivery: boolean | undefined;
  if (typeof deliveryRaw === "boolean") {
    delivery = deliveryRaw;
  } else if (typeof deliveryRaw === "string") {
    const v = deliveryRaw.trim().toLowerCase();
    if (/^(yes|y|oo|deliver|delivery|padala|true)$/.test(v)) delivery = true;
    if (/^(no|n|hindi|pickup|false)$/.test(v)) delivery = false;
  }

  const qtyNum = Number(src.qty);
  const qty =
    Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum) : undefined;

  return {
    name: typeof src.name === "string" ? src.name.trim().slice(0, 120) : undefined,
    delivery,
    qty,
    preferredWaterType:
      typeof src.preferredWaterType === "string" ?
        src.preferredWaterType.trim().slice(0, 80) :
        undefined,
    location:
      typeof src.location === "string" ? src.location.trim().slice(0, 240) : undefined,
    email: typeof src.email === "string" ? src.email.trim().slice(0, 120) : undefined,
    number:
      typeof src.number === "string" ? src.number.trim().slice(0, 40) : undefined,
  };
}

function mergeFields(
  base: CommunityOrderFields,
  overlay: CommunityOrderFields,
): CommunityOrderFields {
  return {
    name: overlay.name ?? base.name,
    delivery: overlay.delivery ?? base.delivery,
    qty: overlay.qty ?? base.qty,
    preferredWaterType: overlay.preferredWaterType ?? base.preferredWaterType,
    location: overlay.location ?? base.location,
    email: overlay.email ?? base.email,
    number: overlay.number ?? base.number,
    orderRaw: overlay.orderRaw ?? base.orderRaw,
    orderLines: overlay.orderLines ?? base.orderLines,
  };
}

function extractPhone(text: string): string | undefined {
  const match = text.match(
    /(?:\+?63|0)?[\s-]*9\d{2}[\s-]*\d{3}[\s-]*\d{4}\b|\b09\d{9}\b|\b9\d{9}\b/,
  );
  if (!match) return undefined;
  const digits = match[0].replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return digits;
  return match[0].trim().slice(0, 40);
}

function extractQty(text: string): number | undefined {
  const patterns = [
    /(\d+)\s*(?:gal(?:lon|ons)?|galon|jugs?|containers?|pcs|pieces|bote)/i,
    /(?:qty|quantity|dami|order)\s*[:=]?\s*(\d+)/i,
    /\b(\d+)\s*(?:lang|po)?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const qty = Number(match[1]);
    if (Number.isFinite(qty) && qty > 0 && qty <= 200) return Math.round(qty);
  }
  return undefined;
}

function extractDelivery(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (
    /\b(pickup|pick\s*up|sundo|sasundo|pick-up)\b/.test(lower) ||
    /\bhindi\s+(deliver|padala)\b/.test(lower)
  ) {
    return false;
  }
  if (/\b(deliver|delivery|padala|i-?deliver|idadeliver)\b/.test(lower)) {
    return true;
  }
  return undefined;
}

function extractWaterType(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\balkaline\b/.test(lower)) return "alkaline";
  if (/\bmineral\b/.test(lower)) return "mineral";
  if (/\bpurified\b|\bpuri\b/.test(lower)) return "purified";
  return undefined;
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].slice(0, 120) : undefined;
}

function extractName(text: string): string | undefined {
  const nameToken = "([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .\\-]{1,60})";
  const patterns = [
    new RegExp(
      `(?:ako\\s+si|pangalan\\s*(?:ko)?\\s*(?:ay|:)?|name\\s*(?:is|:)|i\\s*am)\\s+${nameToken}`,
      "i",
    ),
    new RegExp(`(?:customer|suki)\\s*[:=]\\s*${nameToken}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = match[1].trim().replace(/[.,;!?]+$/, "").slice(0, 120);
    if (name.length >= 2) return name;
  }
  return undefined;
}

function extractLocation(text: string): string | undefined {
  const patterns = [
    /(?:address|location|lugar|landmark|sa)\s*[:=]\s*(.+)$/im,
    /(?:deliver(?:y)?\s+(?:sa|to|at))\s+(.+)$/im,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const location = match[1].trim().slice(0, 240);
    if (location.length >= 4) return location;
  }
  return undefined;
}

/**
 * Deterministic free-text extract — no Gemini.
 * Used first so common Taglish order phrases skip paid NLU.
 */
export function parseCommunityFreeTextOrderLocal(
  message: string,
): CommunityFreeTextParseResult {
  const trimmed = message.trim().slice(0, 1200);
  if (!trimmed) return { ...FALLBACK, source: "local" };

  const fields: CommunityOrderFields = {
    name: extractName(trimmed),
    delivery: extractDelivery(trimmed),
    qty: extractQty(trimmed),
    preferredWaterType: extractWaterType(trimmed),
    location: extractLocation(trimmed),
    email: extractEmail(trimmed),
    number: extractPhone(trimmed),
  };

  const filled = Object.values(fields).filter((v) => v !== undefined && v !== "").length;
  const errors = validateCommunityOrderFields(fields);
  const confidence =
    errors.length === 0 ? 0.9 :
      filled >= 3 ? 0.7 :
        filled >= 1 ? 0.45 :
          0.15;

  return {
    fields,
    confidence,
    clarifyingQuestion:
      errors.length > 0 ? FALLBACK.clarifyingQuestion : undefined,
    source: "local",
  };
}

function localIsSufficient(local: CommunityFreeTextParseResult): boolean {
  return (
    validateCommunityOrderFields(local.fields).length === 0 &&
    local.confidence >= 0.65
  );
}

/**
 * AI-04 — parse unstructured Messenger text into community order fields.
 * Local/regex first; Gemini only when needed and within per-PSID rate limit.
 */
export async function parseCommunityFreeTextOrder(
  message: string,
  opts: { psid?: string } = {},
): Promise<CommunityFreeTextParseResult> {
  const trimmed = message.trim().slice(0, 1200);
  if (!trimmed) return { ...FALLBACK };

  const local = parseCommunityFreeTextOrderLocal(trimmed);
  if (localIsSufficient(local)) {
    return { ...local, clarifyingQuestion: undefined };
  }

  if (!getGeminiApiKey()) {
    return {
      ...local,
      clarifyingQuestion:
        local.clarifyingQuestion ||
        "Salamat po! Para sa order, paki-send: name, qty, delivery (yes/no), mobile number, at address kung delivery.",
      source: local.fields && Object.keys(local.fields).length ? "local" : "fallback",
    };
  }

  if (!tryConsumeNluAiSlot(opts.psid)) {
    return {
      ...local,
      clarifyingQuestion:
        local.clarifyingQuestion || FALLBACK.clarifyingQuestion,
      source: "rate_limited",
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
    user: `Message:\n${trimmed}\n\nLocal hints (may be partial):\n${JSON.stringify(local.fields)}`,
    fallback: {},
    temperature: 0.25,
    operation: "community.nlu",
  });

  const aiFields = normalizeAiFields(raw as Record<string, unknown>);
  const fields = mergeFields(local.fields, aiFields);
  const confidence = Math.min(
    1,
    Math.max(0, Number(raw?.confidence) || local.confidence || 0),
  );
  const validationErrors = validateCommunityOrderFields(fields);
  const needsClarification = confidence < 0.65 || validationErrors.length > 0;

  return {
    fields,
    confidence,
    clarifyingQuestion: needsClarification ?
      (typeof raw?.clarifyingQuestion === "string" ?
        raw.clarifyingQuestion.trim().slice(0, 280) :
        local.clarifyingQuestion || FALLBACK.clarifyingQuestion) :
      undefined,
    source: "ai",
  };
}
