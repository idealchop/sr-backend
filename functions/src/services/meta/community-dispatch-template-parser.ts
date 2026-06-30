/** Normalized community Page order fields (CP-03 / order-template-spec). */
export type CommunityOrderFields = {
  name?: string;
  delivery?: boolean;
  qty?: number;
  preferredWaterType?: string;
  location?: string;
  email?: string;
  number?: string;
};

export type CommunityTemplateParseResult = {
  ok: boolean;
  fields: CommunityOrderFields;
  /** Missing or invalid field keys, e.g. `number`, `location`. */
  errors: string[];
  /** Raw label → value map from the template. */
  raw: Record<string, string>;
  /** True when the message appears to be a template attempt (not casual chat). */
  looksLikeTemplate: boolean;
};

type LabelSpec = {
  key: keyof CommunityOrderFields | "deliveryRaw" | "qtyRaw";
  field: keyof CommunityOrderFields;
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

const NORMALIZED_LABEL_TO_FIELD = new Map<string, keyof CommunityOrderFields>();

for (const spec of LABEL_SPECS) {
  for (const alias of spec.aliases) {
    NORMALIZED_LABEL_TO_FIELD.set(normalizeLabel(alias), spec.field);
  }
}

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
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return undefined;
  return raw.trim();
}

function parseEmailValue(raw: string): string | undefined {
  const email = raw.trim();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

function assignField(
  fields: CommunityOrderFields,
  raw: Record<string, string>,
  field: keyof CommunityOrderFields,
  value: string,
): void {
  raw[field] = value;
  if (field === "delivery") {
    fields.delivery = parseDeliveryValue(value);
    return;
  }
  if (field === "qty") {
    fields.qty = parseQtyValue(value);
    return;
  }
  if (field === "number") {
    fields.number = parsePhoneValue(value);
    return;
  }
  if (field === "email") {
    fields.email = parseEmailValue(value);
    return;
  }
  if (field === "name") {
    fields.name = value.trim().slice(0, 120) || undefined;
    return;
  }
  if (field === "preferredWaterType") {
    fields.preferredWaterType = value.trim().slice(0, 80) || undefined;
    return;
  }
  if (field === "location") {
    fields.location = value.trim().slice(0, 240) || undefined;
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
    if (!pair || !pair.value) continue;
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
    if (value) {
      inlinePairs.push({ label: current.label, value });
    }
  }

  return inlinePairs.length >= 2 ? inlinePairs : linePairs;
}

function countRecognizedLabels(text: string): number {
  const fields = new Set<keyof CommunityOrderFields>();
  for (const pair of extractLabelValuePairs(text)) {
    const field = NORMALIZED_LABEL_TO_FIELD.get(normalizeLabel(pair.label));
    if (field) fields.add(field);
  }
  return fields.size;
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
    return { ok: false, fields, errors: ["name", "qty", "number", "location"], raw, looksLikeTemplate: false };
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
  if (fields.delivery === undefined) errors.push("delivery");
  if (fields.qty === undefined || fields.qty <= 0) errors.push("qty");
  if (!fields.number) errors.push("number");
  if (fields.delivery === true && !fields.location?.trim()) errors.push("location");
  if (fields.email && !parseEmailValue(fields.email)) errors.push("email");

  return errors;
}

export const COMMUNITY_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  delivery: "Delivery or pickup (optional — defaults to delivery)",
  qty: "Quantity",
  location: "Address",
  number: "Phone Number",
  email: "Email",
  preferredWaterType: "Water",
};
