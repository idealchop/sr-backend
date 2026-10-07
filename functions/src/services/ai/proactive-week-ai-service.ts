import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import type { ProactiveScheduleSuggestionInput } from "../proactive-schedule/proactive-schedule-week-snapshot-service";
import { manilaDateKey, manilaPreferredDayNum } from "../../utils/philippine-datetime";

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
        source: "history",
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

export type HabitCustomerInput = {
  id?: string;
  name: string;
  isDeliveryEnabled?: boolean;
  isCollectionEnabled?: boolean;
  deliveryConfig?: { preferredDays?: number[] };
  collectionConfig?: { preferredDays?: number[] };
  lastFulfilledAt?: unknown;
  lastFulfilledType?: string;
  forecastAccuracyRollup?: {
    delivery?: { hitCount?: number; missCount?: number };
    collection?: { hitCount?: number; missCount?: number };
  };
};

export type HabitTxInput = {
  customerId?: string;
  type: string;
  scheduledAt?: unknown;
  createdAt?: unknown;
  waterRefills?: Array<{ quantity?: number; qty?: number }>;
};

export type CustomerHabitSample = {
  id: string;
  name: string;
  isDeliveryEnabled: boolean;
  isCollectionEnabled: boolean;
  preferredDeliveryDays: number[];
  preferredCollectionDays: number[];
  lastFulfilledAt?: string;
  lastFulfilledType?: string;
  orderWeekdays: Record<string, number>;
  typicalQty?: number;
  forecastHitRate?: number;
};

function toInstant(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ?
        parsed :
        null;
    } catch {
      return null;
    }
  }
  return null;
}

function refillQty(tx: HabitTxInput): number {
  if (!Array.isArray(tx.waterRefills) || tx.waterRefills.length === 0) return 0;
  return tx.waterRefills.reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity ?? line.qty) || 0),
    0,
  );
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ?
    Math.round((sorted[mid - 1] + sorted[mid]) / 2) :
    sorted[mid];
}

/** Weekday histogram + mix from recent orders (1 = Monday … 7 = Sunday). */
export function summarizeCustomerOrderHabits(
  customer: HabitCustomerInput,
  transactions: HabitTxInput[],
): CustomerHabitSample | null {
  const id = typeof customer.id === "string" ? customer.id.trim() : "";
  if (!id) return null;

  const orderWeekdays: Record<string, number> = {};
  const qtys: number[] = [];
  for (const tx of transactions) {
    if (tx.customerId !== id) continue;
    if (tx.type === "expense") continue;
    const at = toInstant(tx.scheduledAt) ?? toInstant(tx.createdAt);
    if (at) {
      const day = String(manilaPreferredDayNum(at));
      orderWeekdays[day] = (orderWeekdays[day] || 0) + 1;
    }
    const qty = refillQty(tx);
    if (qty > 0) qtys.push(qty);
  }

  const lastAt = toInstant(customer.lastFulfilledAt);
  const deliveryHits = Number(customer.forecastAccuracyRollup?.delivery?.hitCount) || 0;
  const deliveryMisses = Number(customer.forecastAccuracyRollup?.delivery?.missCount) || 0;
  const collectionHits = Number(customer.forecastAccuracyRollup?.collection?.hitCount) || 0;
  const collectionMisses =
    Number(customer.forecastAccuracyRollup?.collection?.missCount) || 0;
  const scored = deliveryHits + deliveryMisses + collectionHits + collectionMisses;
  const hits = deliveryHits + collectionHits;

  const typicalQty = median(qtys);
  return {
    id,
    name: customer.name,
    isDeliveryEnabled: Boolean(customer.isDeliveryEnabled),
    isCollectionEnabled: Boolean(customer.isCollectionEnabled),
    preferredDeliveryDays: customer.deliveryConfig?.preferredDays ?? [],
    preferredCollectionDays: customer.collectionConfig?.preferredDays ?? [],
    ...(lastAt ? { lastFulfilledAt: manilaDateKey(lastAt) } : {}),
    ...(customer.lastFulfilledType ?
      { lastFulfilledType: customer.lastFulfilledType } :
      {}),
    orderWeekdays,
    ...(typicalQty != null ? { typicalQty } : {}),
    ...(scored > 0 ? { forecastHitRate: Math.round((hits / scored) * 100) } : {}),
  };
}

/**
 * AI-03 — LLM proactive week from preferred-day seed + order habit.
 * Persisted rows override the current week snapshot. Falls back to seed
 * when Gemini is unavailable.
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
    .filter((t) => t.type !== "expense")
    .slice(0, 50)
    .map((t) => {
      const at = toInstant(t.scheduledAt) ?? toInstant(t.createdAt);
      return {
        customerId: t.customerId,
        customerName: t.customerName,
        type: t.type,
        weekday: at ? manilaPreferredDayNum(at) : undefined,
        qty: refillQty(t),
        date: at ? manilaDateKey(at) : undefined,
      };
    });

  const customerSample = customers
    .slice(0, 50)
    .map((c) => summarizeCustomerOrderHabits(c, transactions))
    .filter((row): row is CustomerHabitSample => row != null);

  const system =
    "You plan a water refilling station's proactive delivery/collection week in the Philippines. " +
    "Use ONLY customer ids/names from JSON. Output STRICT JSON: suggestions (array, max 40), " +
    "summary (one line), each suggestion with id, customerId, customerName, " +
    "scheduledDate (YYYY-MM-DD within window), kind (delivery|collection), " +
    "refillItems [{type, qty}], returnContainers [], rationale (≤200 chars), " +
    "reason (one line why this date — cite habit, not only preferredDays). " +
    "Never invent customers. Prefer order habit (orderWeekdays, lastFulfilledAt, typicalQty) " +
    "over preferredDays when they disagree. You MAY move, add, or drop visits vs " +
    "deterministicSuggestions (the current week forecast) so the saved list is the AI week.";

  const user =
    `Window: ${windowLabel} (${windowStart.toISOString()} to ${windowEnd.toISOString()})\n` +
    `Current week forecast to override (${deterministicSuggestions.length} rows):\n` +
    `${JSON.stringify(deterministicSuggestions.slice(0, 25), null, 2)}\n\n` +
    `Customer habits:\n${JSON.stringify(customerSample, null, 2)}\n\n` +
    `Recent orders:\n${JSON.stringify(historySample, null, 2)}`;

  const raw = await geminiGenerateJson<LlmWeekResponse>({
    system,
    user,
    fallback: FALLBACK,
    operation: "proactive_week.generate",
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
          "AI replaced this week's list using order habits." :
          undefined,
  };
}
