import { geminiGenerateJson } from "../gemini-client";
import { getGeminiApiKey } from "../gemini-config";
import {
  RIVER_AI_AGENT_TOOLS,
  type RiverAiAgentIntentResult,
  type RiverAiAgentToolId,
} from "./river-ai-agent-types";

const FALLBACK: RiverAiAgentIntentResult = {
  tool: "chat.answer",
  parameters: {},
  confidence: 0.3,
  clarifyingQuestion: "Ano ang gusto mong gawin? (hal. list customers, add delivery, record payment)",
};

function isToolId(v: string): v is RiverAiAgentToolId {
  return (RIVER_AI_AGENT_TOOLS as readonly string[]).includes(v);
}

function manilaDateISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function offsetManilaDateISO(offsetDays: number): string {
  const today = manilaDateISO();
  const [year, month, day] = today.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return utc.toISOString().slice(0, 10);
}

function scheduledAtFromHint(text: string): string {
  if (/\b(tomorrow|bukas)\b/i.test(text)) {
    return `${offsetManilaDateISO(1)}T08:00:00.000+08:00`;
  }
  if (/\b(today|ngayon)\b/i.test(text)) {
    return `${manilaDateISO()}T08:00:00.000+08:00`;
  }
  return new Date().toISOString();
}

function parseAmountFromText(text: string): number | undefined {
  const match = text.match(/(?:₱|php\s*)?(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function isPaidHint(text: string): boolean {
  return /\b(paid|bayad na|nabayaran|cash paid)\b/i.test(text);
}

function parseDeliveryCustomerName(rest: string): string {
  return rest
    .replace(/(\d+)\s*(?:gallons?|gal|gals?)\b/gi, " ")
    .replace(/\b(today|ngayon|tomorrow|bukas|paid|bayad na|nabayaran|cash paid)\b/gi, " ")
    .replace(/[,.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExpenseDescription(rest: string, amount?: number): string {
  let description = rest
    .replace(/(?:₱|php\s*)?\d+(?:\.\d+)?/gi, " ")
    .replace(/\b(paid|bayad na|nabayaran|cash)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!description && amount != null) description = "Expense";
  return description || "Expense";
}

function extractCustomerSearchHint(text: string): string | null {
  const patterns = [
    /(?:show|find|get|lookup|hanapin|sino\s+si)\s+(?:customer|suki|client)?\s*(.+)/i,
    /(?:customer|suki)\s+(?:named|named?|na\s+si|si)?\s*(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const hint = match?.[1]?.trim().replace(/[?.!]+$/, "");
    if (hint && hint.length >= 2) return hint;
  }
  return null;
}

/** Skip Gemini for obvious ops commands (faster + works without API key). */
export function parseFastRiverAiAgentIntent(message: string): RiverAiAgentIntentResult | null {
  const text = message.trim();
  if (!text) return null;

  if (
    /\b(customers?|suki)\b.*\b(balance|utang|may utang|may balance)\b/i.test(text) ||
    /\b(balance|utang)\b.*\b(customers?|suki)\b/i.test(text)
  ) {
    return { tool: "customer.list", parameters: { hasBalance: true }, confidence: 0.96 };
  }

  if (
    /\blist\b.*\b(customers?|suki)\b/i.test(text) ||
    /\b(customers?|suki)\b.*\blist\b/i.test(text) ||
    /\b(show|display|get)\s+all\b.*\b(customers?|suki)\b/i.test(text) ||
    /^show\s+customers\b/i.test(text)
  ) {
    return { tool: "customer.list", parameters: {}, confidence: 0.98 };
  }

  if (
    /\b(today|ngayon|today'?s)\b.*\b(deliveries|transactions?|orders?)\b/i.test(text) ||
    /\b(deliveries|transactions?|orders?)\b.*\b(today|ngayon)\b/i.test(text) ||
    /\b(pending|for delivery)\b.*\b(today|ngayon)\b/i.test(text)
  ) {
    const today = manilaDateISO();
    return {
      tool: "transaction.list",
      parameters: { startDate: today, endDate: today, type: "delivery" },
      confidence: 0.96,
    };
  }

  const unpaidOrderPattern = new RegExp(
    "\\b(unpaid|di\\s+bayad|hindi\\s+pa\\s+bayad|outstanding)\\b.*" +
      "\\b(transactions?|orders?|deliveries)\\b",
    "i",
  );
  const orderUnpaidPattern = new RegExp(
    "\\b(transactions?|orders?|deliveries)\\b.*\\b(unpaid|di\\s+bayad|outstanding)\\b",
    "i",
  );
  if (unpaidOrderPattern.test(text) || orderUnpaidPattern.test(text)) {
    return { tool: "transaction.list", parameters: { unpaid: true }, confidence: 0.96 };
  }

  if (
    /\b(list|show|display|get\s+all)\b.*\b(transactions?|orders?|deliveries)\b/i.test(text) ||
    /\b(transactions?|orders?)\b.*\b(list|show)\b/i.test(text)
  ) {
    return { tool: "transaction.list", parameters: {}, confidence: 0.98 };
  }

  if (
    /\b(low\s+stock|ubos|konti\s+na|mababa)\b.*\b(inventory|stock)\b/i.test(text) ||
    /\b(inventory|stock)\b.*\b(low\s+stock|ubos|konti\s+na)\b/i.test(text)
  ) {
    return { tool: "inventory.list", parameters: { lowStock: true }, confidence: 0.96 };
  }

  if (
    /\b(list|show|display)\b.*\b(inventory|stock)\b/i.test(text) ||
    /\binventory\b.*\b(list|show)\b/i.test(text)
  ) {
    return { tool: "inventory.list", parameters: {}, confidence: 0.98 };
  }

  if (
    /\b(list|show|display)\b.*\bcatalog\b/i.test(text) ||
    /\bcatalog\b.*\b(list|show)\b/i.test(text)
  ) {
    return { tool: "catalog.list", parameters: {}, confidence: 0.98 };
  }

  if (
    /\b(magkano|kinita|kita|sales|revenue|earning|kumita)\b.*\b(today|ngayon)\b/i.test(text) ||
    /\b(today|ngayon)\b.*\b(magkano|kinita|kita|sales|revenue)\b/i.test(text) ||
    /\b(today|daily|ngayon)\b.*\b(summary|overview|report)\b/i.test(text)
  ) {
    return { tool: "report.today_summary", parameters: {}, confidence: 0.97 };
  }

  if (
    /\blist\b.*\b(riders?|delivery\s+staff)\b/i.test(text) ||
    /\b(riders?|delivery\s+staff)\b.*\blist\b/i.test(text) ||
    /^show\s+riders\b/i.test(text)
  ) {
    return { tool: "rider.list", parameters: {}, confidence: 0.98 };
  }

  const customerHint = extractCustomerSearchHint(text);
  if (
    customerHint &&
    customerHint.length >= 2 &&
    !/\blist\b/i.test(text) &&
    !/^all\b/i.test(customerHint) &&
    !/^customers?$/i.test(customerHint) &&
    !/^suki$/i.test(customerHint)
  ) {
    return { tool: "customer.get", parameters: { search: customerHint }, confidence: 0.96 };
  }

  return null;
}

/** Skip Gemini for obvious write drafts (still requires user confirm). */
export function parseFastWriteRiverAiAgentIntent(message: string): RiverAiAgentIntentResult | null {
  const text = message.trim();
  if (!text) return null;

  const addMatch = text.match(/(?:add|create|new)\s+(?:customer|suki)\s+(.+)/i);
  if (addMatch?.[1]) {
    const rest = addMatch[1].trim();
    const phoneMatch = rest.match(/\b(0\d{10})\b/);
    const phone = phoneMatch?.[1];
    const name = rest.replace(/\b0\d{10}\b/, "").trim();
    if (name) {
      return {
        tool: "customer.create",
        parameters: { name, phone: phone || undefined },
        confidence: 0.92,
      };
    }
  }

  const payMatch = text.match(
    /record\s+payment\s+(?:of\s+)?(?:₱|php\s*)?(\d+(?:\.\d+)?)\s+(?:for|sa|to)?\s*(.+)/i,
  );
  if (payMatch) {
    const amount = Number(payMatch[1]);
    const referenceId = payMatch[2].trim().split(/\s+/)[0];
    if (Number.isFinite(amount) && amount > 0 && referenceId) {
      return {
        tool: "transaction.record_payment",
        parameters: { amount, referenceId },
        confidence: 0.9,
      };
    }
  }

  const markMatch = text.match(/\bmark\s+(.+?)\s+(?:as\s+)?(?:delivered|complete|done)\b/i);
  if (markMatch?.[1]) {
    return {
      tool: "transaction.set_fulfillment_status",
      parameters: { referenceId: markMatch[1].trim(), fulfillmentStatus: "delivered" },
      confidence: 0.9,
    };
  }

  const assignMatch = text.match(/\bassign\s+(?:rider\s+)?(.+?)\s+(?:to|sa)\s+(.+)/i);
  if (assignMatch?.[1] && assignMatch[2]) {
    return {
      tool: "transaction.assign_rider",
      parameters: { riderName: assignMatch[1].trim(), referenceId: assignMatch[2].trim() },
      confidence: 0.88,
    };
  }

  const stockMatch = text.match(
    /\badjust\s+(?:stock\s+)?(?:for\s+)?(.+?)\s+(?:by\s+)?([+-]?\d+)\b/i,
  );
  if (stockMatch?.[1] && stockMatch[2]) {
    return {
      tool: "inventory.adjust_stock",
      parameters: { itemName: stockMatch[1].trim(), delta: Number(stockMatch[2]) },
      confidence: 0.88,
    };
  }

  const deliveryMatch = text.match(
    /(?:add|create|schedule|book)\s+(?:a\s+)?delivery\s+(?:for|sa|to)\s+(.+)/i,
  );
  if (deliveryMatch?.[1]) {
    const rest = deliveryMatch[1].trim();
    const qtyMatch = rest.match(/(\d+)\s*(?:gallons?|gal|gals?)\b/i);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    const customerName = parseDeliveryCustomerName(rest);
    if (customerName.length >= 2) {
      return {
        tool: "transaction.create",
        parameters: {
          subtype: "delivery",
          customerName,
          quantity,
          scheduledAt: scheduledAtFromHint(rest),
        },
        confidence: 0.9,
      };
    }
  }

  const walkinMatch = text.match(
    /(?:add|record|create)\s+walk-?in(?:\s+(?:sale|transaction))?\s*(.*)$/i,
  );
  if (walkinMatch) {
    const rest = (walkinMatch[1] || "").trim();
    const qtyMatch = rest.match(/(\d+)\s*(?:gallons?|gal|gals?)\b/i);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    const totalAmount = parseAmountFromText(rest);
    const customerName = parseDeliveryCustomerName(rest);
    return {
      tool: "transaction.create",
      parameters: {
        subtype: "walkin",
        quantity,
        customerName: customerName.length >= 2 ? customerName : "Walk-in",
        totalAmount,
        paymentStatus: isPaidHint(rest) ? "paid" : undefined,
        paid: isPaidHint(rest) || undefined,
        scheduledAt: scheduledAtFromHint(rest),
      },
      confidence: 0.9,
    };
  }

  const expenseMatch = text.match(/(?:add|record|create)\s+expense\s+(.*)$/i);
  if (expenseMatch?.[1]) {
    const rest = expenseMatch[1].trim();
    const totalAmount = parseAmountFromText(rest);
    if (totalAmount != null) {
      return {
        tool: "transaction.create",
        parameters: {
          subtype: "expense",
          totalAmount,
          notes: parseExpenseDescription(rest, totalAmount),
          paymentStatus: isPaidHint(rest) ? "paid" : undefined,
          paid: isPaidHint(rest) || undefined,
          scheduledAt: new Date().toISOString(),
        },
        confidence: 0.9,
      };
    }
  }

  return null;
}

/**
 * Classify owner ops commands into agent tools + parameters.
 */
export async function parseRiverAiAgentIntent(input: {
  message: string;
  businessName?: string;
}): Promise<RiverAiAgentIntentResult> {
  const message = input.message.trim().slice(0, 1500);
  if (!message) return { ...FALLBACK };

  const fast = parseFastRiverAiAgentIntent(message);
  if (fast) return fast;

  const fastWrite = parseFastWriteRiverAiAgentIntent(message);
  if (fastWrite) return fastWrite;

  if (!getGeminiApiKey()) {
    return {
      tool: "chat.answer",
      parameters: { question: message },
      confidence: 0.5,
      replyHint: "AI agent parser not configured.",
    };
  }

  const system =
    "You route owner commands for a Philippine water refilling station app (SmartRefill). " +
    "You embody seven roles: technician (equipment/PM), water expert (TDS/pH/hygiene), " +
    "business analyst (snapshot numbers), encyclopedia (their station data), instructor (steps), " +
    "staff assistant (draft writes), companion (growth ideas). " +
    "Pick exactly one tool id from the allowed list. Output STRICT JSON: " +
    "tool (string), parameters (object), confidence (0-1), clarifyingQuestion (optional, Taglish), replyHint (optional). " +
    "READ tools: customer.list, customer.get, transaction.list, transaction.get, inventory.list, catalog.list, rider.list, report.today_summary. " +
    "WRITE tools (draft only — user must confirm): customer.create, customer.update, customer.set_status, " +
    "transaction.create, transaction.update, transaction.set_fulfillment_status, transaction.record_payment, " +
    "transaction.assign_rider, transaction.report_collection_issue, inventory.create, inventory.update, " +
    "inventory.adjust_stock, catalog.upsert_water_type, catalog.upsert_inventory_category, catalog.upsert_expense_category. " +
    "Use chat.answer for general how-to questions without data mutation. " +
    "For transaction.create set parameters.subtype: delivery|walkin|walkin_with_direct_sale|direct_sale|expense|collection. " +
    "Extract customerName, phone, address, quantities, amounts, dates, referenceId, riderName, paymentAmount, status fields when present.";

  const user =
    `Station: ${input.businessName || "WRS"}\n` +
    `Allowed tools: ${RIVER_AI_AGENT_TOOLS.join(", ")}\n` +
    `Command:\n${message}`;

  const raw = await geminiGenerateJson<RiverAiAgentIntentResult>({
    system,
    user,
    fallback: FALLBACK,
    maxOutputTokens: 800,
    temperature: 0.2,
  });

  const tool = typeof raw?.tool === "string" && isToolId(raw.tool) ? raw.tool : "chat.answer";
  const parameters =
    raw?.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters) ?
      (raw.parameters as Record<string, unknown>) :
      {};
  const confidence = Math.min(1, Math.max(0, Number(raw?.confidence) || 0));

  if (confidence < 0.45 && tool !== "chat.answer") {
    return {
      tool: "chat.answer",
      parameters: { question: message },
      confidence,
      clarifyingQuestion:
        typeof raw?.clarifyingQuestion === "string" ?
          raw.clarifyingQuestion.slice(0, 240) :
          FALLBACK.clarifyingQuestion,
    };
  }

  return {
    tool,
    parameters,
    confidence,
    clarifyingQuestion:
      typeof raw?.clarifyingQuestion === "string" ?
        raw.clarifyingQuestion.trim().slice(0, 240) :
        undefined,
    replyHint: typeof raw?.replyHint === "string" ? raw.replyHint.trim().slice(0, 300) : undefined,
  };
}
