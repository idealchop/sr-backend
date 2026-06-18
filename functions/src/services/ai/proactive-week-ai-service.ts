import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import type { ProactiveScheduleSuggestionInput } from "../proactive-schedule/proactive-schedule-week-snapshot-service";

export type LlmProactiveWeekRow = ProactiveScheduleSuggestionInput & {
  reason?: string;
  confidence?: number;
};

type LlmWeekResponse = {
  suggestions: LlmProactiveWeekRow[];
  summary?: string;
};

const FALLBACK: LlmWeekResponse = { suggestions: [] };

/**
 * AI-03 — LLM proactive week generation stub (augments deterministic build).
 * Falls back to empty suggestions when Gemini is unavailable.
 */
export async function generateLlmProactiveWeek(params: {
  businessId: string;
  windowLabel: string;
  deterministicSuggestions?: ProactiveScheduleSuggestionInput[];
}): Promise<LlmWeekResponse> {
  const { businessId, windowLabel, deterministicSuggestions = [] } = params;

  if (!getGeminiApiKey()) {
    return { suggestions: deterministicSuggestions, summary: "Deterministic plan only — AI not configured." };
  }

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId).then((rows) => rows.slice(0, 80)),
    TransactionService.getTransactionsByBusiness(businessId, { limit: 100 }),
  ]);

  const historySample = transactions
    .filter((t) => t.type !== "expense" && t.type !== "collection")
    .slice(0, 40)
    .map((t) => ({
      customerName: t.customerName,
      type: t.type,
      totalAmount: t.totalAmount,
      scheduledAt: t.scheduledAt,
    }));

  const customerSample = customers.slice(0, 40).map((c) => ({
    id: c.id,
    name: c.name,
    isDeliveryEnabled: c.isDeliveryEnabled,
    isCollectionEnabled: c.isCollectionEnabled,
  }));

  const system =
    "You plan a water refilling station's proactive delivery/collection week in the Philippines. " +
    "Use ONLY customer ids/names from JSON. Output STRICT JSON: suggestions (array, max 40), " +
    "each with id, customerId, customerName, scheduledDate (YYYY-MM-DD), kind (delivery|collection), " +
    "refillItems [{type, qty}], returnContainers [], rationale (≤200 chars), reason (one line why this date). " +
    "Never invent customers. Prefer augmenting deterministicSuggestions when provided.";

  const user =
    `Window: ${windowLabel}\n` +
    `Deterministic seed (${deterministicSuggestions.length} rows):\n` +
    `${JSON.stringify(deterministicSuggestions.slice(0, 20), null, 2)}\n\n` +
    `Customers:\n${JSON.stringify(customerSample, null, 2)}\n\n` +
    `Recent orders:\n${JSON.stringify(historySample, null, 2)}`;

  const raw = await geminiGenerateJson<LlmWeekResponse>({
    system,
    user,
    fallback: FALLBACK,
  });

  const suggestions = Array.isArray(raw?.suggestions) && raw.suggestions.length > 0 ?
    raw.suggestions :
    deterministicSuggestions;

  return {
    suggestions,
    summary: typeof raw?.summary === "string" ? raw.summary.trim() : undefined,
  };
}
