import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import type { ProactiveScheduleSuggestionInput } from "../proactive-schedule/proactive-schedule-week-snapshot-service";

export type LlmProactiveWeekRow = ProactiveScheduleSuggestionInput & {
  reason?: string;
  confidence?: number;
};

export type LlmWeekResponse = {
  suggestions: LlmProactiveWeekRow[];
  summary?: string;
};

const FALLBACK: LlmWeekResponse = { suggestions: [] };
const RATIONALE_MAX = 200;
const REASON_MAX = 200;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isDayInWindow(day: Date, start: Date, end: Date): boolean {
  const t = startOfDay(day).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

function parseDay(iso: string): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00+08:00` : iso);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

function sanitizeLines(
  rows: unknown,
  fallback: Array<{ type: string; qty: number }>,
): Array<{ type: string; qty: number }> {
  if (!Array.isArray(rows) || rows.length === 0) return fallback;
  return rows.slice(0, 20).map((line) => {
    const o = line as Record<string, unknown>;
    return {
      type: String(o.type || "Purified").slice(0, 80),
      qty: Math.max(0, Number(o.qty) || 0),
    };
  });
}

type MergeOpts = {
  allowedCustomerIds: Set<string>;
  customerNames: Map<string, string>;
  windowStart: Date;
  windowEnd: Date;
};

/** AI-03 — validate and normalize one LLM row against allowlists. */
export function validateLlmProactiveWeekRow(
  raw: unknown,
  opts: MergeOpts,
): LlmProactiveWeekRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const customerId = typeof o.customerId === "string" ? o.customerId.trim() : "";
  if (!customerId || !opts.allowedCustomerIds.has(customerId)) return null;

  const kind = o.kind === "collection" ? "collection" : o.kind === "delivery" ? "delivery" : null;
  if (!kind) return null;

  const scheduledRaw =
    typeof o.scheduledDate === "string" ? o.scheduledDate.trim() : "";
  const scheduledDay = parseDay(scheduledRaw);
  if (
    !scheduledDay ||
    !isDayInWindow(scheduledDay, opts.windowStart, opts.windowEnd)
  ) {
    return null;
  }

  const expectedName = opts.customerNames.get(customerId);
  const customerName =
    typeof o.customerName === "string" && o.customerName.trim() ?
      o.customerName.trim().slice(0, 200) :
      expectedName || "Customer";

  const rationale =
    typeof o.rationale === "string" && o.rationale.trim() ?
      o.rationale.trim().slice(0, RATIONALE_MAX) :
      "AI-adjusted from visit pattern";
  const reason =
    typeof o.reason === "string" && o.reason.trim() ?
      o.reason.trim().slice(0, REASON_MAX) :
      undefined;

  const id =
    typeof o.id === "string" && o.id.trim() ?
      o.id.trim().slice(0, 120) :
      `ai-${customerId}-${kind}-${scheduledRaw.slice(0, 10)}`;

  return {
    id,
    customerId,
    customerName,
    scheduledDate: scheduledDay.toISOString(),
    kind,
    refillItems: sanitizeLines(o.refillItems, [{ type: "Purified", qty: 1 }]),
    returnContainers: Array.isArray(o.returnContainers) ?
      o.returnContainers.slice(0, 20).map((line) => {
        const row = line as Record<string, unknown>;
        return {
          inventoryId: String(row.inventoryId || "").slice(0, 120),
          qty: Math.max(0, Number(row.qty) || 0),
        };
      }) :
      [],
    rationale,
    reason,
    source: "history",
  };
}

/** AI-03 — overlay validated LLM rows onto deterministic seeds. */
export function mergeProactiveWeekSuggestions(
  deterministic: ProactiveScheduleSuggestionInput[],
  llmRows: LlmProactiveWeekRow[],
  opts: MergeOpts,
): ProactiveScheduleSuggestionInput[] {
  const byKey = new Map<string, ProactiveScheduleSuggestionInput>();
  for (const row of deterministic) {
    byKey.set(`${row.customerId}|${row.kind}`, { ...row });
  }

  for (const raw of llmRows) {
    const validated = validateLlmProactiveWeekRow(raw, opts);
    if (!validated) continue;
    const key = `${validated.customerId}|${validated.kind}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        scheduledDate: validated.scheduledDate,
        refillItems:
          validated.refillItems.some((l) => l.qty > 0) ?
            validated.refillItems :
            existing.refillItems,
        returnContainers:
          validated.returnContainers.length > 0 ?
            validated.returnContainers :
            existing.returnContainers,
        rationale: validated.rationale || existing.rationale,
        reason: validated.reason,
        source: existing.source ?? "history",
      });
    } else {
      byKey.set(key, validated);
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.customerName.localeCompare(b.customerName),
  );
}

/**
 * AI-03 — LLM proactive week generation (augments deterministic build).
 * Falls back to deterministic rows when Gemini is unavailable.
 */
export async function generateLlmProactiveWeek(params: {
  businessId: string;
  windowLabel: string;
  windowStart: Date;
  windowEnd: Date;
  deterministicSuggestions?: ProactiveScheduleSuggestionInput[];
}): Promise<LlmWeekResponse> {
  const {
    businessId,
    windowLabel,
    windowStart,
    windowEnd,
    deterministicSuggestions = [],
  } = params;

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId).then((rows) => rows.slice(0, 120)),
    TransactionService.getTransactionsByBusiness(businessId, { limit: 150 }),
  ]);

  const allowedCustomerIds = new Set(
    customers
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const customerNames = new Map(
    customers
      .filter((c): c is typeof c & { id: string } =>
        typeof c.id === "string" && c.id.length > 0,
      )
      .map((c) => [c.id, c.name]),
  );
  for (const row of deterministicSuggestions) {
    allowedCustomerIds.add(row.customerId);
    customerNames.set(row.customerId, row.customerName);
  }

  const mergeOpts: MergeOpts = {
    allowedCustomerIds,
    customerNames,
    windowStart,
    windowEnd,
  };

  if (!getGeminiApiKey()) {
    return {
      suggestions: deterministicSuggestions,
      summary: "Deterministic plan only — AI not configured.",
    };
  }

  const historySample = transactions
    .filter((t) => t.type !== "expense" && t.type !== "collection")
    .slice(0, 50)
    .map((t) => ({
      customerId: t.customerId,
      customerName: t.customerName,
      type: t.type,
      totalAmount: t.totalAmount,
      scheduledAt: t.scheduledAt,
    }));

  const customerSample = customers.slice(0, 50).map((c) => ({
    id: c.id,
    name: c.name,
    isDeliveryEnabled: c.isDeliveryEnabled,
    isCollectionEnabled: c.isCollectionEnabled,
  }));

  const system =
    "You plan a water refilling station's proactive delivery/collection week in the Philippines. " +
    "Use ONLY customer ids/names from JSON. Output STRICT JSON: suggestions (array, max 40), " +
    "summary (one line), each suggestion with id, customerId, customerName, " +
    "scheduledDate (YYYY-MM-DD within window), kind (delivery|collection), " +
    "refillItems [{type, qty}], returnContainers [], rationale (≤200 chars), " +
    "reason (one line why this date). Never invent customers. " +
    "Refine deterministicSuggestions — adjust dates/qty when history supports it.";

  const user =
    `Window: ${windowLabel} (${windowStart.toISOString()} to ${windowEnd.toISOString()})\n` +
    `Deterministic seed (${deterministicSuggestions.length} rows):\n` +
    `${JSON.stringify(deterministicSuggestions.slice(0, 25), null, 2)}\n\n` +
    `Customers:\n${JSON.stringify(customerSample, null, 2)}\n\n` +
    `Recent orders:\n${JSON.stringify(historySample, null, 2)}`;

  const raw = await geminiGenerateJson<LlmWeekResponse>({
    system,
    user,
    fallback: FALLBACK,
  });

  const llmRows = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const merged =
    llmRows.length > 0 ?
      mergeProactiveWeekSuggestions(deterministicSuggestions, llmRows, mergeOpts) :
      deterministicSuggestions;

  return {
    suggestions: merged,
    summary:
      typeof raw?.summary === "string" && raw.summary.trim() ?
        raw.summary.trim().slice(0, 400) :
        llmRows.length > 0 ?
          "AI refined your week plan from order history." :
          undefined,
  };
}
