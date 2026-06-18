import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";
import {
  buildCompactContext,
} from "./ai-tool-run-service";
import { enrichAiToolSnapshot } from "./ai-tool-snapshot-enrichers";
import { buildOwnerUsageGoalsContext } from "../../utils/usage-goals";
import { TransactionService } from "../transactions/transaction-service";
import { CustomerService } from "../customers/customer-service";
import { InventoryService } from "../inventory/inventory-service";
import { db } from "../../config/firebase-admin";

export type DashboardQaAnswer = {
  question: string;
  answer: string;
  highlights: string[];
  snapshotKeysUsed: string[];
};

/**
 * AI-12 — natural-language dashboard Q&A from precomputed snapshot (not raw Firestore).
 */
export async function answerDashboardQuestion(params: {
  businessId: string;
  question: string;
}): Promise<DashboardQaAnswer> {
  const question = params.question.trim().slice(0, 400);
  if (!question) {
    return {
      question: "",
      answer: "Please ask a question about your station.",
      highlights: [],
      snapshotKeysUsed: [],
    };
  }

  const [transactions, customers, inventoryItems, businessSnap] = await Promise.all([
    TransactionService.getTransactionsByBusiness(params.businessId, { limit: 120 }),
    CustomerService.getCustomersByBusiness(params.businessId).then((rows) => rows.slice(0, 150)),
    InventoryService.listItems(params.businessId).then((rows) => rows.slice(0, 80)),
    db.collection("businesses").doc(params.businessId).get(),
  ]);

  const businessData = businessSnap.data() || {};
  const businessName = String(businessData.name || "Station");
  const usageGoals = buildOwnerUsageGoalsContext(businessData.usageGoals);
  const uiConfig = (businessData.uiConfig ?? {}) as Record<string, unknown>;
  const now = new Date();

  const snapshot = buildCompactContext({
    businessName,
    transactions,
    customers,
    inventory: inventoryItems,
    usageGoals,
  });
  snapshot.question = question;

  await enrichAiToolSnapshot("morning_brief", snapshot, {
    businessId: params.businessId,
    businessName,
    transactions,
    customers,
    inventory: inventoryItems,
    uiConfig,
    now,
  });

  const compactFacts = {
    dormant: snapshot.dormantSignals,
    topUnpaid: snapshot.topUnpaidCustomers,
    financialSignals: snapshot.financialSignals,
    aiEnrichments: snapshot.aiEnrichments,
  };

  if (!getGeminiApiKey()) {
    return {
      question,
      answer: "River AI is not configured. Check dormant count and AR in your dashboard metrics.",
      highlights: [],
      snapshotKeysUsed: Object.keys(compactFacts),
    };
  }

  const system =
    "You answer owner questions about their water refilling station using ONLY the JSON facts. " +
    "Respond in clear English; short Taglish OK. Output STRICT JSON: answer (string), " +
    "highlights (array, max 5), snapshotKeysUsed (array of JSON keys you relied on). " +
    "Do not invent customers or amounts.";

  const raw = await geminiGenerateJson<{
    answer?: string;
    highlights?: string[];
    snapshotKeysUsed?: string[];
  }>({
    system,
    user: `Question: ${question}\n\nFacts:\n${JSON.stringify(compactFacts, null, 2)}`,
    fallback: { answer: "Could not reach the model. Try again shortly.", highlights: [] },
  });

  return {
    question,
    answer: typeof raw?.answer === "string" ? raw.answer.trim() : "No answer generated.",
    highlights: Array.isArray(raw?.highlights) ?
      raw.highlights.filter((h): h is string => typeof h === "string").slice(0, 5) :
      [],
    snapshotKeysUsed: Array.isArray(raw?.snapshotKeysUsed) ?
      raw.snapshotKeysUsed.filter((k): k is string => typeof k === "string") :
      [],
  };
}
