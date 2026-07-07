import type { CollectionItem, CollectionItemStatus } from "../transactions/transaction-service";

export type ParsedReportBreakdown =
  | { mode: "simple"; qtyOk: number }
  | { mode: "breakdown"; qtyOk: number; qtyMissing: number; qtyDamaged: number };

export type ReportParseContext = {
  qtyExpected?: number;
  collectionItems?: CollectionItem[];
  currentItemIndex?: number;
};

const CONTAINER_HINT_TOKENS = [
  "round",
  "slim",
  "square",
  "pet",
  "gallon",
  "galon",
  "container",
  "jug",
  "bottle",
  "takip",
];

function normalizeReportText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function containerMatchScore(text: string, item: CollectionItem): number {
  const name = item.name.toLowerCase();
  let score = 0;

  for (const token of CONTAINER_HINT_TOKENS) {
    if (text.includes(token) && name.includes(token)) score += 12;
  }

  if (name.length >= 3 && text.includes(name)) score += 24;

  for (const word of name.split(/\s+/)) {
    const clean = word.replace(/[^a-z0-9]/g, "");
    if (clean.length >= 4 && text.includes(clean)) score += 6;
  }

  return score;
}

function isFreeTextReportReply(text: string): boolean {
  return hasFreeTextReportKeywords(normalizeReportText(text));
}

function isSingleContainerCollection(items: CollectionItem[]): boolean {
  if (items.length <= 1) return true;
  const families = new Set(
    items.map((item) => {
      const name = item.name.toLowerCase();
      for (const token of ["round", "slim", "square", "pet"]) {
        if (name.includes(token)) return token;
      }
      return name;
    }),
  );
  return families.size === 1;
}

export function resolveReportTargetIndex(
  text: string,
  items: CollectionItem[],
  currentItemIndex?: number,
):
  | { index: number }
  | { error: "need_container"; options: string[] }
  | { error: "ambiguous"; options: string[] } {
  if (!items.length) {
    return { error: "need_container", options: [] };
  }

  const normalized = normalizeReportText(text);
  const freeText = isFreeTextReportReply(text);

  if (!freeText) {
    if (
      currentItemIndex != null &&
      currentItemIndex >= 0 &&
      currentItemIndex < items.length
    ) {
      return { index: currentItemIndex };
    }
    if (isSingleContainerCollection(items)) return { index: 0 };
    return { error: "need_container", options: items.map((i) => i.name) };
  }

  if (isSingleContainerCollection(items)) return { index: 0 };

  const ranked = items
    .map((item, index) => ({ index, score: containerMatchScore(normalized, item) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 1) return { index: ranked[0].index };
  if (ranked.length > 1 && ranked[0].score > ranked[1].score) {
    return { index: ranked[0].index };
  }
  if (ranked.length > 1) {
    return {
      error: "ambiguous",
      options: ranked.map((row) => items[row.index].name),
    };
  }

  return { error: "need_container", options: items.map((i) => i.name) };
}

export function findNextUnreportedCollectionIndex(items: CollectionItem[]): number {
  return items.findIndex(
    (item) =>
      item.status === "pending" &&
      (item.qtyOk ?? 0) === 0 &&
      (item.qtyMissing ?? 0) === 0 &&
      (item.qtyDamaged ?? 0) === 0,
  );
}

export function formatReportNeedContainerMessage(options: string[]): string {
  if (!options.length) return "Walang collection items.";
  if (options.length === 1) {
    return `I-specify ang container sa reply (hal. ${options[0]} kulang ng lima).`;
  }
  return [
    "I-specify ang container sa reply:",
    ...options.map((name) => `• ${name}`),
    "",
    "Hal: round kulang ng lima · slim may 1 sira",
  ].join("\n");
}

const FILIPINO_NUMBERS: Record<string, number> = {
  isa: 1,
  isang: 1,
  one: 1,
  dalawa: 2,
  dalawang: 2,
  two: 2,
  tatlo: 3,
  tatlong: 3,
  three: 3,
  apat: 4,
  apatna: 4,
  four: 4,
  lima: 5,
  limang: 5,
  five: 5,
  anim: 6,
  animna: 6,
  six: 6,
  pito: 7,
  pitong: 7,
  seven: 7,
  walo: 8,
  walong: 8,
  eight: 8,
  siyam: 9,
  siyamna: 9,
  nine: 9,
  sampu: 10,
  sampung: 10,
  ten: 10,
};

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parseFilipinoWord(token: string): number | undefined {
  const key = token.toLowerCase().replace(/\s+/g, "");
  return FILIPINO_NUMBERS[key];
}

/** Extract first quantity from a fragment (digit or Filipino word). */
export function parseQuantityFromFragment(fragment: string): number | undefined {
  const trimmed = fragment.trim();
  if (!trimmed) return undefined;

  const digit = trimmed.match(/(\d+)/);
  if (digit?.[1]) {
    const n = parseNonNegativeInt(digit[1]);
    if (n != null) return n;
  }

  const words = trimmed.toLowerCase().split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z0-9]/g, "");
    const fromWord = parseFilipinoWord(clean);
    if (fromWord != null) return fromWord;
  }

  for (const [word, value] of Object.entries(FILIPINO_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(trimmed)) return value;
  }

  return undefined;
}

const FREE_TEXT_REPORT_KEYWORDS = new RegExp(
  "(?:kulang|sira|rusak|broken|damage|damaged|missing|takip|cover|lid|good|ok\\b|" +
    "\\bg\\s*:|o\\s*:|m\\s*:|d\\s*:)",
  "i",
);

function hasFreeTextReportKeywords(normalized: string): boolean {
  return FREE_TEXT_REPORT_KEYWORDS.test(normalized);
}

function tryParseStructuredBreakdown(raw: string): {
  qtyOk: number;
  qtyMissing: number;
  qtyDamaged: number;
} | null {
  const hasLabels =
    /(?:\b(?:good|ok|missing|miss|damage|damaged|dmg)\b\s*[:.]?\s*\d)/i.test(raw) ||
    /(?:\b[ogmd]\s*[:.]?\s*\d)/i.test(raw);

  if (!hasLabels) return null;

  const pick = (patterns: RegExp[]): number | undefined => {
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      const value = parseNonNegativeInt(match?.[1]);
      if (value != null) return value;
    }
    return undefined;
  };

  const qtyOk = pick([
    /\b(?:good|ok)\s*[:.]?\s*(\d+)/i,
    /\bg\s*[:.]?\s*(\d+)/i,
    /\bo\s*[:.]?\s*(\d+)/i,
  ]) ?? 0;
  const qtyMissing = pick([
    /\b(?:missing|miss)\s*[:.]?\s*(\d+)/i,
    /\bm\s*[:.]?\s*(\d+)/i,
  ]) ?? 0;
  const qtyDamaged = pick([
    /\b(?:damaged|damage|dmg)\s*[:.]?\s*(\d+)/i,
    /\bd\s*[:.]?\s*(\d+)/i,
  ]) ?? 0;

  if (qtyOk === 0 && qtyMissing === 0 && qtyDamaged === 0) return null;
  return { qtyOk, qtyMissing, qtyDamaged };
}

function tryParseFreeTextBreakdown(
  normalized: string,
  qtyExpected?: number,
): { qtyOk: number; qtyMissing: number; qtyDamaged: number } | null {
  let qtyMissing = 0;
  let qtyDamaged = 0;
  let qtyOk: number | undefined;
  let matched = false;

  if (/kulang(?:\s+(?:ng|na))?\s+(?:isang\s+)?takip/i.test(normalized)) {
    qtyMissing = 1;
    matched = true;
  } else if (/walang?\s+(?:isang\s+)?takip/i.test(normalized)) {
    qtyMissing = 1;
    matched = true;
  } else {
    const kulangMatch =
      normalized.match(/kulang(?:\s+(?:ng|na))?\s+([^,.]+?)(?:\s+(?:yung|ung)\b|$|,|\.)/i) ??
      normalized.match(/kulang(?:\s+(?:ng|na))?\s+(.+)$/i);
    if (kulangMatch?.[1]) {
      const fragment = kulangMatch[1].trim();
      if (/takip|cover|lid|tapa/i.test(fragment)) {
        qtyMissing = parseQuantityFromFragment(fragment) ?? 1;
      } else {
        const parsed = parseQuantityFromFragment(fragment);
        if (parsed != null) qtyMissing = parsed;
      }
      if (qtyMissing > 0) matched = true;
    }
  }

  const siraMatch = normalized.match(/(?:may\s+)?([^,.]+?)\s+sira\b/i);
  if (siraMatch?.[1]) {
    qtyDamaged = parseQuantityFromFragment(siraMatch[1]) ?? 1;
    matched = true;
  } else if (
    /\bsira\b|\brusak\b|\bbroken\b|\bdamaged?\b/i.test(normalized) &&
    !/walang\s+sira/i.test(normalized)
  ) {
    qtyDamaged = parseQuantityFromFragment(normalized) ?? 1;
    matched = true;
  }

  const okLabelMatch =
    normalized.match(/\b(?:good|ok)\s*[:.]?\s*(\d+)/i) ??
    normalized.match(/\b(\d+)\s+(?:good|ok)\b/i) ??
    normalized.match(/\bg\s*[:.]?\s*(\d+)/i) ??
    normalized.match(/\bo\s*[:.]?\s*(\d+)/i);
  if (okLabelMatch?.[1]) {
    qtyOk = parseNonNegativeInt(okLabelMatch[1]);
    matched = true;
  }

  if (!matched) return null;

  const expected = Math.max(0, qtyExpected ?? 0);
  if (qtyOk == null && expected > 0) {
    qtyOk = Math.max(0, expected - qtyMissing - qtyDamaged);
  }
  if (qtyOk == null) {
    qtyOk = 0;
  }

  return { qtyOk, qtyMissing, qtyDamaged };
}

/** Parse rider reply: number, labels (G/O/M/D), or Taglish free text. */
export function parseReportBreakdownReply(
  text: string,
  context?: ReportParseContext,
): ParsedReportBreakdown | null {
  const raw = text.trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase().replace(/\s+/g, " ");

  if (/^\d+$/.test(normalized)) {
    return { mode: "simple", qtyOk: Number.parseInt(normalized, 10) };
  }

  if (!hasFreeTextReportKeywords(normalized)) {
    const loneQty = parseQuantityFromFragment(normalized);
    if (loneQty != null) {
      return { mode: "simple", qtyOk: loneQty };
    }
  }

  const structured = tryParseStructuredBreakdown(raw);
  if (structured) {
    return { mode: "breakdown", ...structured };
  }

  const freeText = tryParseFreeTextBreakdown(normalized, context?.qtyExpected);
  if (freeText) {
    return { mode: "breakdown", ...freeText };
  }

  return null;
}

export function applyReportBreakdownToCollectionItem(
  item: CollectionItem,
  breakdown: ParsedReportBreakdown,
): CollectionItem {
  if (breakdown.mode === "simple") {
    const qty = breakdown.qtyOk;
    const expected = Math.max(0, item.qtyExpected || 0);
    const deficitQty = Math.max(0, expected - qty);
    return {
      ...item,
      qtyCollected: qty,
      qtyOk: qty,
      qtyDamaged: 0,
      qtyMissing: deficitQty,
      deficitQty,
      status: deficitQty > 0 ? "missing" : "ok",
    };
  }

  const qtyExpected = Math.max(0, item.qtyExpected ?? 0);
  const qtyDamaged = Math.min(breakdown.qtyDamaged, qtyExpected);
  let qtyMissing = Math.min(
    breakdown.qtyMissing,
    Math.max(0, qtyExpected - qtyDamaged),
  );
  const qtyOk = Math.min(
    breakdown.qtyOk,
    Math.max(0, qtyExpected - qtyDamaged - qtyMissing),
  );

  const accounted = qtyOk + qtyDamaged + qtyMissing;
  if (accounted < qtyExpected) {
    qtyMissing += qtyExpected - accounted;
  }

  const deficitQty = Math.max(0, qtyExpected - qtyOk - qtyDamaged - qtyMissing);

  let status: CollectionItemStatus = "ok";
  if (qtyOk > qtyExpected) status = "recovered";
  else if (qtyDamaged > 0) status = "damaged";
  else if (qtyMissing > 0 || deficitQty > 0) status = "missing";
  else if (qtyOk === qtyExpected) status = "ok";

  return {
    ...item,
    qtyOk,
    qtyDamaged,
    qtyMissing,
    qtyCollected: qtyOk,
    deficitQty,
    status,
    replacedFromInventory:
      item.replacedFromInventory ?? (qtyDamaged > 0 || qtyMissing > 0),
  };
}

export function formatReportItemAck(item: CollectionItem): string {
  return `OK ${item.qtyOk ?? 0} · Missing ${item.qtyMissing ?? 0} · Damage ${item.qtyDamaged ?? 0}`;
}
