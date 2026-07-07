/** One parsed line from the Order: field — qty, container, and water type. */
export type CommunityOrderLine = {
  qty: number;
  container: "round" | "slim";
  waterType: "alkaline" | "mineral" | "purified";
};

/** Normalized community Page order fields (CP-03 / order-template-spec). */
export type CommunityOrderFields = {
  name?: string;
  delivery?: boolean;
  qty?: number;
  preferredWaterType?: string;
  location?: string;
  email?: string;
  number?: string;
  /** Raw Order: field text, e.g. "3 slim - alkaline, 4 round - purified". */
  orderRaw?: string;
  orderLines?: CommunityOrderLine[];
};

export type CommunityTemplateParseResult = {
  ok: boolean;
  fields: CommunityOrderFields;
  /** Missing or invalid field keys, e.g. `order`, `location`. */
  errors: string[];
  /** Raw label → value map from the template. */
  raw: Record<string, string>;
  /** True when the message appears to be a template attempt (not casual chat). */
  looksLikeTemplate: boolean;
};

type LabelSpec = {
  key: keyof CommunityOrderFields | "deliveryRaw" | "qtyRaw" | "orderRaw";
  field: keyof CommunityOrderFields | "orderRaw";
  aliases: string[];
};

const LABEL_SPECS: LabelSpec[] = [
  {
    key: "name",
    field: "name",
    aliases: ["name", "pangalan", "customer name", "customer", "fullname", "full name"],
  },
  {
    key: "deliveryRaw",
    field: "delivery",
    aliases: ["delivery", "deliver", "pickup", "pick up", "padala", "deliver ba"],
  },
  {
    key: "qtyRaw",
    field: "qty",
    aliases: ["qty", "quantity", "dami", "galon", "gallon", "gallons", "pcs", "pieces"],
  },
  {
    key: "orderRaw",
    field: "orderRaw",
    aliases: ["order", "orders", "refill order", "refill", "my order"],
  },
  {
    key: "preferredWaterType",
    field: "preferredWaterType",
    aliases: [
      "preferred water",
      "preferred water type",
      "water type",
      "water",
      "tipo ng tubig",
      "klaseng tubig",
    ],
  },
  {
    key: "location",
    field: "location",
    aliases: ["location", "address", "landmark", "lugar", "delivery address", "area"],
  },
  {
    key: "email",
    field: "email",
    aliases: ["email", "e-mail", "email address"],
  },
  {
    key: "number",
    field: "number",
    aliases: ["number", "phone", "phone number", "mobile", "cp", "cellphone", "contact", "contact number"],
  },
];

const NORMALIZED_LABEL_TO_FIELD = new Map<string, keyof CommunityOrderFields | "orderRaw">();

for (const spec of LABEL_SPECS) {
  for (const alias of spec.aliases) {
    NORMALIZED_LABEL_TO_FIELD.set(normalizeLabel(alias), spec.field);
  }
}

const ORDER_LINE_PATTERN =
  /(\d+)\s*(round|slim)\s*[-–—]?\s*(alkaline|mineral|purified)/gi;

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split "label: value", "label - value", or "label value" lines. */
function splitLabelValue(line: string): { label: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const colon = trimmed.match(/^([^:]+):\s*(.*)$/);
  if (colon) {
    return { label: colon[1].trim(), value: colon[2].trim() };
  }

  const dash = trimmed.match(/^([^–—-]+)[–—-]\s*(.+)$/);
  if (dash) {
    return { label: dash[1].trim(), value: dash[2].trim() };
  }

  return null;
}

function normalizePlaceholderValue(value: string): string {
  const v = value.trim();
  if (/^\(required\)$/i.test(v)) return "";
  if (/^\(optional\)$/i.test(v)) return "";
  if (/^\(required\)\s+format/i.test(v)) return "";
  if (/^(none|n\/?a|na|wala|no email|no number|no phone)$/i.test(v)) return "";
  return v;
}

function isPlaceholderOrderValue(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^\(required\)/i.test(v) && /format/i.test(v)) return true;
  return false;
}

function parseDeliveryValue(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (/^(yes|y|oo|opo|true|1|deliver|delivery|padala)$/.test(v)) return true;
  if (/^(no|n|hindi|false|0|pickup|pick up|pick-up|self pickup|collect)$/.test(v)) {
    return false;
  }
  return undefined;
}

function parseQtyValue(raw: string): number | undefined {
  const match = raw.trim().match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function parsePhoneValue(raw: string): string | undefined {
  const normalized = normalizePlaceholderValue(raw);
  if (!normalized) return undefined;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return undefined;
  return normalized;
}

function parseEmailValue(raw: string): string | undefined {
  const email = normalizePlaceholderValue(raw);
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

/** Parse Order: lines like "3 slim - alkaline, 4 round - purified". */
export function parseCommunityOrderLines(raw: string): CommunityOrderLine[] {
  const lines: CommunityOrderLine[] = [];
  ORDER_LINE_PATTERN.lastIndex = 0;

  let match = ORDER_LINE_PATTERN.exec(raw);
  while (match) {
    const qty = Number(match[1]);
    if (Number.isFinite(qty) && qty > 0) {
      lines.push({
        qty: Math.round(qty),
        container: match[2].toLowerCase() as "round" | "slim",
        waterType: match[3].toLowerCase() as "alkaline" | "mineral" | "purified",
      });
    }
    match = ORDER_LINE_PATTERN.exec(raw);
  }

  return lines;
}

export function formatCommunityOrderLines(lines: CommunityOrderLine[]): string {
  return lines
    .map((line) => `${line.qty} ${line.container} - ${line.waterType}`)
    .join(", ");
}

function applyOrderField(
  fields: CommunityOrderFields,
  raw: Record<string, string>,
  value: string,
): void {
  const normalized = normalizePlaceholderValue(value);
  if (isPlaceholderOrderValue(normalized)) return;

  raw.orderRaw = normalized;
  fields.orderRaw = normalized.slice(0, 240) || undefined;

  const lines = parseCommunityOrderLines(normalized);
  if (lines.length) {
    fields.orderLines = lines;
    fields.qty = lines.reduce((sum, line) => sum + line.qty, 0);
    fields.preferredWaterType = formatCommunityOrderLines(lines);
  }
}

function assignField(
  fields: CommunityOrderFields,
  raw: Record<string, string>,
  field: keyof CommunityOrderFields | "orderRaw",
  value: string,
): void {
  if (field === "orderRaw") {
    applyOrderField(fields, raw, value);
    return;
  }

  const normalized = normalizePlaceholderValue(value);
  raw[field] = normalized;

  if (field === "delivery") {
    fields.delivery = parseDeliveryValue(normalized);
    return;
  }
  if (field === "qty") {
    fields.qty = parseQtyValue(normalized);
    return;
  }
  if (field === "number") {
    fields.number = parsePhoneValue(normalized);
    return;
  }
  if (field === "email") {
    fields.email = parseEmailValue(normalized);
    return;
  }
  if (field === "name") {
    fields.name = normalized.slice(0, 120) || undefined;
    return;
  }
  if (field === "preferredWaterType") {
    fields.preferredWaterType = normalized.slice(0, 80) || undefined;
    return;
  }
  if (field === "location") {
    fields.location = normalized.slice(0, 240) || undefined;
  }
}

function normalizeTemplateText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\uFF1A/g, ":")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest aliases first so "preferred water station" wins over "station". */
function buildLabelBoundaryPattern(): RegExp {
  const aliases = [...NORMALIZED_LABEL_TO_FIELD.keys()].sort((a, b) => b.length - a.length);
  const joined = aliases.map(escapeRegExp).join("|");
  return new RegExp(`(?:^|[\\s\\n])(${joined})\\s*:\\s*`, "gi");
}

const LABEL_BOUNDARY_PATTERN = buildLabelBoundaryPattern();

type LabelMatch = { label: string; labelStart: number; valueStart: number };

function extractInlineLabelMatches(text: string): LabelMatch[] {
  const matches: LabelMatch[] = [];
  LABEL_BOUNDARY_PATTERN.lastIndex = 0;

  let match = LABEL_BOUNDARY_PATTERN.exec(text);
  while (match) {
    const label = match[1]?.trim();
    if (label && NORMALIZED_LABEL_TO_FIELD.has(normalizeLabel(label))) {
      const labelStart = match.index + Math.max(0, match[0].indexOf(match[1]));
      matches.push({
        label,
        labelStart,
        valueStart: match.index + match[0].length,
      });
    }
    match = LABEL_BOUNDARY_PATTERN.exec(text);
  }

  return matches;
}

function extractLabelValuePairs(text: string): Array<{ label: string; value: string }> {
  const normalized = normalizeTemplateText(text);
  if (!normalized) return [];

  const linePairs: Array<{ label: string; value: string }> = [];
  for (const line of normalized.split("\n")) {
    const pair = splitLabelValue(line);
    if (!pair) continue;
    if (!NORMALIZED_LABEL_TO_FIELD.has(normalizeLabel(pair.label))) continue;
    linePairs.push(pair);
  }

  if (linePairs.length >= 2) {
    return linePairs;
  }

  const inlineMatches = extractInlineLabelMatches(normalized);
  if (inlineMatches.length < 2) {
    return linePairs;
  }

  const inlinePairs: Array<{ label: string; value: string }> = [];
  for (let i = 0; i < inlineMatches.length; i += 1) {
    const current = inlineMatches[i];
    const next = inlineMatches[i + 1];
    const valueEnd = next ? next.labelStart : normalized.length;
    const value = normalized.slice(current.valueStart, valueEnd).trim();
    inlinePairs.push({ label: current.label, value });
  }

  return inlinePairs.length >= 2 ? inlinePairs : linePairs;
}

function countRecognizedLabels(text: string): number {
  const fields = new Set<string>();
  for (const pair of extractLabelValuePairs(text)) {
    const field = NORMALIZED_LABEL_TO_FIELD.get(normalizeLabel(pair.label));
    if (field) fields.add(field);
  }
  return fields.size;
}

function usesNewOrderFormat(fields: CommunityOrderFields): boolean {
  return Boolean(fields.orderRaw || fields.orderLines?.length);
}

/**
 * CP-03 — parse label:value community order templates (case-insensitive, alias-tolerant).
 */
export function parseCommunityOrderTemplate(text: string): CommunityTemplateParseResult {
  const trimmed = normalizeTemplateText(text);
  const raw: Record<string, string> = {};
  const fields: CommunityOrderFields = {};
  const looksLikeTemplate = countRecognizedLabels(trimmed) >= 2;

  if (!trimmed) {
    return {
      ok: false,
      fields,
      errors: ["name", "order", "location"],
      raw,
      looksLikeTemplate: false,
    };
  }

  for (const pair of extractLabelValuePairs(trimmed)) {
    const field = NORMALIZED_LABEL_TO_FIELD.get(normalizeLabel(pair.label));
    if (!field) continue;
    assignField(fields, raw, field, pair.value);
  }

  const normalizedFields = applyCommunityOrderDefaults(fields);
  const errors = validateCommunityOrderFields(normalizedFields);
  return {
    ok: errors.length === 0,
    fields: normalizedFields,
    errors,
    raw,
    looksLikeTemplate,
  };
}

/** Community Page orders default to delivery when the form omits delivery:. */
export function applyCommunityOrderDefaults(
  fields: CommunityOrderFields,
): CommunityOrderFields {
  return {
    ...fields,
    delivery: fields.delivery ?? true,
  };
}

/** CP-04 — required-field validation for community intake. */
export function validateCommunityOrderFields(fields: CommunityOrderFields): string[] {
  const errors: string[] = [];

  if (!fields.name?.trim()) errors.push("name");

  const hasOrderLines = (fields.orderLines?.length ?? 0) > 0;
  const hasLegacyQty = fields.qty !== undefined && fields.qty > 0 && !usesNewOrderFormat(fields);

  if (hasOrderLines) {
    if (fields.delivery === true && !fields.location?.trim()) errors.push("location");
  } else if (hasLegacyQty) {
    if (fields.delivery === undefined) errors.push("delivery");
    if (fields.qty === undefined || fields.qty <= 0) errors.push("qty");
    if (!fields.number) errors.push("number");
    if (fields.delivery === true && !fields.location?.trim()) errors.push("location");
  } else {
    errors.push("order");
    if (fields.delivery === true && !fields.location?.trim()) errors.push("location");
  }

  if (fields.email && !parseEmailValue(fields.email)) errors.push("email");

  return errors;
}

export const COMMUNITY_FIELD_LABELS: Record<string, string> = {
  name: "Pangalan (Name)",
  delivery: "Delivery o pickup (optional — delivery ang default)",
  qty: "Dami",
  order: "Order (hal. 3 slim - alkaline)",
  location: "Address",
  number: "Number (optional lang)",
  email: "Email (optional lang)",
  preferredWaterType: "Klase ng tubig",
};
