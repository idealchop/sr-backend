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

/**
 * Classify owner ops commands into agent tools + parameters.
 */
export async function parseRiverAiAgentIntent(input: {
  message: string;
  businessName?: string;
}): Promise<RiverAiAgentIntentResult> {
  const message = input.message.trim().slice(0, 1500);
  if (!message) return { ...FALLBACK };

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
    "Pick exactly one tool id from the allowed list. Output STRICT JSON: " +
    "tool (string), parameters (object), confidence (0-1), clarifyingQuestion (optional, Taglish), replyHint (optional). " +
    "READ tools: customer.list, customer.get, transaction.list, transaction.get, inventory.list, catalog.list. " +
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
