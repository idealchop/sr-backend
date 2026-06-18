import type {
  SupportStructuredBadge,
  SupportStructuredBadgeTone,
  SupportStructuredHighlight,
  SupportStructuredHighlightVariant,
  SupportStructuredReply,
  SupportStructuredStep,
  SupportStructuredStepPriority,
} from "./support-chat-types";

const ORDERED_LINE_RE = /^(\d+)[.)]\s+(.*)$/;
const BULLET_LINE_RE = /^[-*•]\s+(.*)$/;
const INLINE_ORDERED_RE = /(?:^|\s)(\d+)[.)]\s+/g;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function extractInlineOrderedList(
  text: string,
): { intro: string; items: string[] } | null {
  const markers: { start: number; contentStart: number }[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(INLINE_ORDERED_RE.source, "g");

  while ((match = re.exec(text)) !== null) {
    const leading = match[0].startsWith(" ") ? 1 : 0;
    markers.push({
      start: match.index + leading,
      contentStart: match.index + match[0].length,
    });
  }

  if (markers.length < 2) return null;

  const intro = text.slice(0, markers[0].start).trim();
  const items = markers
    .map((marker, index) => {
      const end = markers[index + 1]?.start ?? text.length;
      return text.slice(marker.contentStart, end).trim();
    })
    .filter(Boolean);

  return items.length >= 2 ? { intro, items } : null;
}

function parseRichTextBlocks(text: string): Array<
  | { type: "paragraph"; text: string }
  | { type: "ordered-list"; items: string[] }
  | { type: "unordered-list"; items: string[] }
> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: Array<
    | { type: "paragraph"; text: string }
    | { type: "ordered-list"; items: string[] }
    | { type: "unordered-list"; items: string[] }
  > = [];
  let orderedItems: string[] = [];
  let unorderedItems: string[] = [];

  const flushOrdered = () => {
    if (!orderedItems.length) return;
    blocks.push({ type: "ordered-list", items: [...orderedItems] });
    orderedItems = [];
  };

  const flushUnordered = () => {
    if (!unorderedItems.length) return;
    blocks.push({ type: "unordered-list", items: [...unorderedItems] });
    unorderedItems = [];
  };

  const flushAll = () => {
    flushOrdered();
    flushUnordered();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const orderedMatch = trimmed.match(ORDERED_LINE_RE);
    const bulletMatch = trimmed.match(BULLET_LINE_RE);

    if (orderedMatch?.[2]) {
      flushUnordered();
      orderedItems.push(orderedMatch[2]);
      continue;
    }

    if (bulletMatch?.[1]) {
      flushOrdered();
      unorderedItems.push(bulletMatch[1]);
      continue;
    }

    flushAll();

    const inline = extractInlineOrderedList(trimmed);
    if (inline) {
      if (inline.intro) blocks.push({ type: "paragraph", text: inline.intro });
      blocks.push({ type: "ordered-list", items: inline.items });
      continue;
    }

    blocks.push({ type: "paragraph", text: trimmed });
  }

  flushAll();
  return blocks.length ? blocks : [{ type: "paragraph", text: normalized }];
}

function stepsFromItems(items: string[]): SupportStructuredStep[] {
  return items.slice(0, 8).map((item, index) => ({
    title: item.replace(/\.\s*$/, "").trim(),
    priority: index === 0 ? "high" : "medium",
  }));
}

/** Pull inline / line-based lists out of summary into structured steps. */
export function enrichStructuredReply(
  structured: SupportStructuredReply,
): SupportStructuredReply {
  if (structured.steps?.length) {
    const inline = extractInlineOrderedList(structured.summary);
    if (!inline) return structured;
    return {
      ...structured,
      summary: inline.intro || structured.summary,
    };
  }

  const blocks = parseRichTextBlocks(structured.summary);
  const introParts: string[] = [];
  const orderedItems: string[] = [];
  const unorderedItems: string[] = [];

  for (const block of blocks) {
    if (block.type === "paragraph") introParts.push(block.text);
    if (block.type === "ordered-list") orderedItems.push(...block.items);
    if (block.type === "unordered-list") unorderedItems.push(...block.items);
  }

  if (orderedItems.length >= 2) {
    return {
      ...structured,
      summary: introParts.join("\n\n").trim() || structured.summary,
      steps: stepsFromItems(orderedItems),
      sectionLabel: structured.sectionLabel || "SAGOT",
    };
  }

  if (unorderedItems.length >= 2 && !structured.highlights?.length) {
    return {
      ...structured,
      summary: introParts.join("\n\n").trim() || structured.summary,
      highlights: unorderedItems.slice(0, 4).map((body) => ({
        title: "Tip",
        body,
        variant: "tip" as const,
      })),
    };
  }

  const inline = extractInlineOrderedList(structured.summary);
  if (!inline) return structured;

  return {
    ...structured,
    summary: inline.intro || structured.summary,
    steps: stepsFromItems(inline.items),
  };
}

function normalizeBadge(raw: unknown): SupportStructuredBadge | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = asString(o.label);
  if (!label) return null;
  const tone = o.tone;
  const validTones: SupportStructuredBadgeTone[] =
    ["info", "success", "warning", "urgent"];
  return {
    label,
    tone: validTones.includes(tone as SupportStructuredBadgeTone) ?
      tone as SupportStructuredBadgeTone :
      "info",
  };
}

function normalizeHighlight(raw: unknown): SupportStructuredHighlight | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asString(o.title);
  const body = asString(o.body);
  if (!title || !body) return null;
  const variant = o.variant;
  const validVariants: SupportStructuredHighlightVariant[] =
    ["tip", "warning", "action", "note"];
  return {
    title,
    body,
    variant: validVariants.includes(variant as SupportStructuredHighlightVariant) ?
      variant as SupportStructuredHighlightVariant :
      "tip",
  };
}

function normalizeStep(raw: unknown): SupportStructuredStep | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asString(o.title);
  if (!title) return null;
  const priority = o.priority;
  const validPriorities: SupportStructuredStepPriority[] =
    ["high", "medium", "low"];
  const tags = Array.isArray(o.tags) ?
    o.tags.map((t) => asString(t)).filter(Boolean).slice(0, 4) :
    undefined;
  return {
    title,
    body: asString(o.body) || undefined,
    priority: validPriorities.includes(priority as SupportStructuredStepPriority) ?
      priority as SupportStructuredStepPriority :
      "medium",
    tags: tags?.length ? tags : undefined,
  };
}

/** Coerce Gemini JSON into a stable card layout payload. */
export function normalizeStructuredReply(raw: unknown): SupportStructuredReply | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const summary = asString(o.summary);
  if (!summary) return undefined;

  const badges = Array.isArray(o.badges) ?
    o.badges.map(normalizeBadge).filter(Boolean) as SupportStructuredBadge[] :
    undefined;
  const highlights = Array.isArray(o.highlights) ?
    o.highlights.map(normalizeHighlight).filter(Boolean) as SupportStructuredHighlight[] :
    undefined;
  const steps = Array.isArray(o.steps) ?
    o.steps.map(normalizeStep).filter(Boolean).slice(0, 6) as SupportStructuredStep[] :
    undefined;

  return enrichStructuredReply({
    sectionLabel: asString(o.sectionLabel) || "SAGOT",
    summary,
    badges: badges?.length ? badges : undefined,
    highlights: highlights?.length ? highlights : undefined,
    steps: steps?.length ? steps : undefined,
    evidence: asString(o.evidence) || undefined,
  });
}

/** Flatten structured cards into plain text for search, learnings, and fallbacks. */
export function structuredReplyToPlainText(structured: SupportStructuredReply): string {
  const parts: string[] = [structured.summary];

  for (const highlight of structured.highlights || []) {
    parts.push(`${highlight.title}: ${highlight.body}`);
  }

  for (const [index, step] of (structured.steps || []).entries()) {
    const prefix = `${index + 1}. ${step.title}`;
    parts.push(step.body ? `${prefix} — ${step.body}` : prefix);
  }

  if (structured.evidence) {
    parts.push(structured.evidence);
  }

  return parts.join("\n\n");
}

/** Wrap plain Taglish text in a minimal card when Gemini did not return structure. */
export function plainTextToStructuredFallback(text: string): SupportStructuredReply {
  return enrichStructuredReply({
    sectionLabel: "SAGOT",
    summary: text.trim(),
  });
}
