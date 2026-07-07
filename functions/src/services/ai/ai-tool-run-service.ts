import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  DEFAULT_GEMINI_MODEL,
  getGeminiApiKey,
  getGeminiModel,
} from "./gemini-config";
import { geminiGenerateJson } from "./gemini-client";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import {
  InventoryService,
  type InventoryItem,
} from "../inventory/inventory-service";
import { CustomerService, type Customer } from "../customers/customer-service";
import {
  buildOwnerUsageGoalsContext,
  type OwnerUsageGoalsContext,
} from "../../utils/usage-goals";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import { buildLowHealthSample } from "../../utils/suki-health-score";
import {
  buildLowRatingSample,
  lowRatingSampleNameKeys,
} from "../../utils/low-rating-sample";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import {
  buildPaymentReminderQueue,
  type PaymentReminderQueueRow,
} from "../../utils/payment-reminder-queue";
import { MaintenanceTemplateService } from "../plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../plant/maintenance-template-utils";
import { ProductionShiftService } from "../plant/production-shift-service";
import {
  buildProductionVarianceAlert,
  sumPlantGallonsForCalendarDate,
} from "../../utils/production-variance-alert";
import { manilaDateKey } from "../../utils/philippine-datetime";
import { enrichAiToolSnapshot, buildPaymentReminderScripts, buildVarianceRootCauseFacts, buildWaterQualityAnomalyFacts } from "./ai-tool-snapshot-enrichers";

export const AI_TOOL_IDS = [
  "morning_brief",
  "retention_pulse",
  "collections_pulse",
  "dispatch_health",
  "warehouse_risk",
  "plant_health",
  "dashboard_qa",
  "churn_risk",
] as const;

export type AiToolId = (typeof AI_TOOL_IDS)[number];

export type AiToolRunRiskLevel = "low" | "medium" | "high";

export type OutreachPlanPriority = "high" | "medium" | "low";

export interface OutreachPlanRow {
  name: string;
  priority: OutreachPlanPriority;
  reason: string;
  suggestedMessage: string;
}

export interface AiToolRunOutput {
  title: string;
  summary: string;
  highlights: string[];
  actionItems: { label: string; detail: string }[];
  riskLevel: AiToolRunRiskLevel;
  outreachPlan?: OutreachPlanRow[];
}

export interface AiToolRunRecord extends AiToolRunOutput {
  id: string;
  tool: AiToolId;
  toolLabel: string;
  dataSnapshot: Record<string, unknown>;
  createdAt: string;
  createdByUid: string;
  aiModel: string;
}

function isAiToolId(v: string): v is AiToolId {
  return (AI_TOOL_IDS as readonly string[]).includes(v);
}

function parseTxDate(t: Transaction): Date {
  const raw = t.scheduledAt ?? t.createdAt;
  if (!raw) return new Date(0);
  if (typeof raw === "string") return new Date(raw);
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

function isTerminalDelivery(status: string | undefined): boolean {
  if (!status) return false;
  return ["completed", "cancelled", "failed", "collected"].includes(status);
}

function toolLabel(tool: AiToolId): string {
  switch (tool) {
  case "morning_brief":
    return "Owner morning brief";
  case "collections_pulse":
    return "Collections & AR pulse";
  case "dispatch_health":
    return "Dispatch backlog scan";
  case "warehouse_risk":
    return "Warehouse & low-stock risk";
  case "retention_pulse":
    return "Inactive suki pulse";
  case "plant_health":
    return "Plant health brief";
  case "dashboard_qa":
    return "Dashboard Q&A";
  case "churn_risk":
    return "Churn risk pulse";
  default:
    return tool;
  }
}

function normalizeGeminiOutput(
  raw: unknown,
  fallbackSummary: string,
): AiToolRunOutput {
  const base: AiToolRunOutput = {
    title: "Station insight",
    summary: fallbackSummary,
    highlights: [],
    actionItems: [],
    riskLevel: "low",
  };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const title =
    typeof o.title === "string" && o.title.trim() ? o.title.trim() : base.title;
  const summary =
    typeof o.summary === "string" && o.summary.trim() ?
      o.summary.trim() :
      base.summary;
  const highlights = Array.isArray(o.highlights) ?
    o.highlights
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 8) :
    [];
  const actionItems: { label: string; detail: string }[] = [];
  if (Array.isArray(o.actionItems)) {
    for (const item of o.actionItems.slice(0, 8)) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const label = typeof it.label === "string" ? it.label.trim() : "";
      const detail = typeof it.detail === "string" ? it.detail.trim() : "";
      if (label && detail) actionItems.push({ label, detail });
    }
  }
  let riskLevel: AiToolRunRiskLevel = "low";
  if (
    o.riskLevel === "medium" ||
    o.riskLevel === "high" ||
    o.riskLevel === "low"
  ) {
    riskLevel = o.riskLevel;
  }
  return { title, summary, highlights, actionItems, riskLevel };
}

function dormantSampleNameKeys(snapshot: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const dormantSignals = snapshot.dormantSignals;
  if (!dormantSignals || typeof dormantSignals !== "object") return keys;
  const sample = (dormantSignals as { sample?: unknown }).sample;
  if (!Array.isArray(sample)) return keys;
  for (const row of sample) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      keys.add(name.trim().toLowerCase());
    }
  }
  return keys;
}

function retentionOutreachNameKeys(snapshot: Record<string, unknown>): Set<string> {
  const keys = dormantSampleNameKeys(snapshot);
  for (const key of lowRatingSampleNameKeys(snapshot)) {
    keys.add(key);
  }
  return keys;
}

function serializeReminderQueue(rows: PaymentReminderQueueRow[]) {
  return rows.map((row) => ({
    name: row.name,
    amountPhp: Math.round(row.amount * 100) / 100,
    oldestDebtDays: row.oldestDebtDays,
    reminderTier: row.reminderTier,
  }));
}

/** AI-02: names allowed in collections_pulse outreachPlan scripts. */
function paymentReminderNameKeys(snapshot: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const field of ["reminderQueue30", "reminderQueue60", "reminderQueue90"] as const) {
    const rows = snapshot[field];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const name = (row as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) {
        keys.add(name.trim().toLowerCase());
      }
    }
  }
  return keys;
}

/** AI-02 — deterministic outreach when Gemini returns no valid scripts. */
function buildCollectionsOutreachFallback(
  snapshot: Record<string, unknown>,
): OutreachPlanRow[] {
  const tierPriority: Record<30 | 60 | 90, OutreachPlanPriority> = {
    90: "high",
    60: "medium",
    30: "low",
  };
  return buildPaymentReminderScripts(snapshot).slice(0, 12).map((row) => ({
    name: row.name,
    priority: tierPriority[row.reminderTier],
    reason:
      `${row.reminderTier}d tier · ₱${row.amountPhp.toFixed(0)} · ` +
      `${row.oldestDebtDays}d oldest`,
    suggestedMessage: row.suggestedScript,
  }));
}

/** BL-02: validate outreach rows against dormantSignals.sample only.
 * @param {unknown} raw Raw outreach plan from Gemini.
 * @param {Set<string>} allowedNameKeys Lowercase names from dormant sample.
 * @return {OutreachPlanRow[]} Validated outreach rows.
 */
export function normalizeOutreachPlan(
  raw: unknown,
  allowedNameKeys: Set<string>,
): OutreachPlanRow[] {
  if (!Array.isArray(raw) || allowedNameKeys.size === 0) return [];
  const rows: OutreachPlanRow[] = [];
  const seen = new Set<string>();

  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const key = name.toLowerCase();
    if (!name || !allowedNameKeys.has(key) || seen.has(key)) continue;

    let priority: OutreachPlanPriority = "medium";
    if (o.priority === "high" || o.priority === "low") {
      priority = o.priority;
    }

    const reason =
      typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";
    let suggestedMessage =
      typeof o.suggestedMessage === "string" ? o.suggestedMessage.trim() : "";
    if (!suggestedMessage) continue;
    suggestedMessage = suggestedMessage.slice(0, 280);

    seen.add(key);
    rows.push({ name, priority, reason, suggestedMessage });
  }

  const priorityRank: Record<OutreachPlanPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return rows.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}

function parseStoredOutreachPlan(raw: unknown): OutreachPlanRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: OutreachPlanRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const suggestedMessage =
      typeof o.suggestedMessage === "string" ? o.suggestedMessage.trim() : "";
    if (!name || !suggestedMessage) continue;
    let priority: OutreachPlanPriority = "medium";
    if (o.priority === "high" || o.priority === "low") {
      priority = o.priority;
    }
    const reason =
      typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";
    rows.push({
      name,
      priority,
      reason,
      suggestedMessage: suggestedMessage.slice(0, 280),
    });
  }
  return rows.length > 0 ? rows : undefined;
}

function parseManilaKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+08:00`);
}

async function buildPlantHealthFacts(
  businessId: string,
  transactions: Transaction[],
  uiConfig: Record<string, unknown>,
  now: Date,
): Promise<Record<string, unknown>> {
  const [shifts, templates] = await Promise.all([
    ProductionShiftService.list(businessId, { limit: 14 }),
    MaintenanceTemplateService.list(businessId),
  ]);
  const maintenance = summarizeMaintenanceOverdue(templates);
  const todayKey = manilaDateKey(now);
  const variance = buildProductionVarianceAlert({
    shifts,
    transactions,
    uiConfig,
    now,
  });
  const gallons7d = shifts
    .filter((row) => {
      const d = row.calendarDate;
      if (!d) return false;
      const diff =
        (parseManilaKey(d).getTime() - parseManilaKey(todayKey).getTime()) /
        86400000;
      return diff >= -6 && diff <= 0;
    })
    .reduce((sum, row) => sum + row.gallonsProduced, 0);

  const latestShift = shifts
    .filter((row) => row.calendarDate)
    .sort((a, b) => String(b.calendarDate).localeCompare(String(a.calendarDate)))[0];
  let lastShiftLogAgeHours: number | null = null;
  if (latestShift?.calendarDate) {
    const shiftDay = parseManilaKey(String(latestShift.calendarDate));
    lastShiftLogAgeHours = Math.round(
      (now.getTime() - shiftDay.getTime()) / (1000 * 60 * 60),
    );
  }

  let openDeliveriesToday = 0;
  let walkInUnitsToday = 0;
  for (const tx of transactions) {
    if (tx.type === "delivery") {
      const st = tx.deliveryStatus || "";
      if (st && !isTerminalDelivery(st)) openDeliveriesToday += 1;
    }
    if (tx.type === "walkin" || tx.type === "direct_sale") {
      const d = parseTxDate(tx);
      if (manilaDateKey(d) === todayKey) {
        walkInUnitsToday += (tx.waterRefills || []).reduce(
          (sum, r) => sum + (Number(r.quantity) || 0),
          0,
        );
      }
    }
  }

  return {
    plantHealth: {
      todayPlantGallons: sumPlantGallonsForCalendarDate(shifts, todayKey),
      plantGallonsLast7Days: Math.round(gallons7d),
      overdueMaintenanceCount: maintenance.overdueCount,
      dueSoonMaintenanceCount: maintenance.dueSoonCount,
      overdueMaintenanceTasks: maintenance.overdueNames.slice(0, 8),
      productionVarianceActive: variance.active,
      productionVariancePct: Math.round(variance.variancePct * 10) / 10,
      plantGallonsToday: variance.plantGallons,
      soldRefillUnitsToday: variance.soldUnits,
      lastShiftLogAgeHours,
      openDeliveriesToday,
      walkInUnitsToday,
    },
  };
}

export function buildCompactContext(params: {
  businessName: string;
  transactions: Transaction[];
  customers: Customer[];
  inventory: InventoryItem[];
  usageGoals: OwnerUsageGoalsContext;
}): Record<string, unknown> {
  const { businessName, transactions, customers, inventory, usageGoals } =
    params;
  const now = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 86400000);

  let expense7d = 0;
  let revenue7d = 0;
  let openDeliveries = 0;
  const unpaidByCustomer = new Map<
    string,
    { name: string; balance: number; txCount: number }
  >();
  const backlog: Array<{
    referenceId: string;
    customerName: string;
    type: string;
    deliveryStatus: string;
    balanceDue: number;
    scheduledAt: string;
  }> = [];

  for (const tx of transactions) {
    if (tx.type === "expense") {
      const d = parseTxDate(tx);
      if (d >= sevenAgo) expense7d += Number(tx.totalAmount) || 0;
      continue;
    }
    if (tx.type === "collection") {
      const d = parseTxDate(tx);
      if (d >= sevenAgo) revenue7d += Number(tx.totalAmount) || 0;
      continue;
    }

    const txDate = parseTxDate(tx);
    if (txDate >= sevenAgo) {
      revenue7d += Number(tx.totalAmount) || 0;
    }

    if (tx.type === "delivery") {
      const st = tx.deliveryStatus || "";
      if (!isTerminalDelivery(st)) openDeliveries += 1;
    }

    const bal = Number(tx.balanceDue) || 0;
    const cid = tx.customerId || tx.customerName;
    if (bal > 0.009) {
      const prev = unpaidByCustomer.get(cid) || {
        name: tx.customerName || "Unknown",
        balance: 0,
        txCount: 0,
      };
      prev.balance += bal;
      prev.txCount += 1;
      unpaidByCustomer.set(cid, prev);
    }

    if (
      tx.type === "delivery" ||
      tx.type === "walkin" ||
      tx.type === "direct_sale"
    ) {
      const st = tx.deliveryStatus || "";
      const open =
        bal > 0.009 ||
        (tx.type === "delivery" && !!st && !isTerminalDelivery(st)) ||
        (tx.type !== "delivery" && !!st && !isTerminalDelivery(st));
      if (open && backlog.length < 18) {
        backlog.push({
          referenceId: tx.referenceId || (tx as { id?: string }).id || "",
          customerName: tx.customerName || "",
          type: tx.type,
          deliveryStatus: st || (tx.type === "delivery" ? "pending" : "n/a"),
          balanceDue: bal,
          scheduledAt: parseTxDate(tx).toISOString(),
        });
      }
    }
  }

  const topUnpaid = [...unpaidByCustomer.values()]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 12);

  const lowStock = inventory
    .filter((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      return cur <= min;
    })
    .slice(0, 20)
    .map((inv) => ({
      name: inv.name,
      current: inv.stock?.current ?? 0,
      min: inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0,
    }));

  const partialCount = transactions.filter(
    (t) =>
      t.type !== "expense" &&
      t.type !== "collection" &&
      t.paymentStatus === "partial",
  ).length;

  const unpaidTx = transactions.filter(
    (t) =>
      t.type !== "expense" &&
      t.type !== "collection" &&
      (Number(t.balanceDue) || 0) > 0.009,
  ).length;

  const goalIds = new Set(usageGoals.ids);
  const dormantSignals = buildDormantSignalsSnapshot(customers, transactions, now);
  const lowHealthSample = buildLowHealthSample(customers, transactions, now);
  const lowRatingSample = buildLowRatingSample(customers, transactions, now);
  const debtAging = computeDebtAgingBreakdown(transactions, customers);
  const reminderPrefs = {
    paymentReminderEnabled: true,
    paymentReminder30Enabled: true,
    paymentReminder60Enabled: true,
    paymentReminder90Enabled: true,
  };
  const reminderQueue = buildPaymentReminderQueue(
    debtAging.rows,
    customers,
    reminderPrefs,
    now,
  );
  const reminderQueue30 = serializeReminderQueue(
    reminderQueue.filter((row) => row.reminderTier === 30).slice(0, 10),
  );
  const reminderQueue60 = serializeReminderQueue(
    reminderQueue.filter((row) => row.reminderTier === 60).slice(0, 10),
  );
  const reminderQueue90 = serializeReminderQueue(
    reminderQueue.filter((row) => row.reminderTier === 90).slice(0, 10),
  );

  return {
    businessName,
    generatedAt: now.toISOString(),
    ownerUsageGoals: {
      ids: usageGoals.ids,
      labels: usageGoals.labels,
      descriptions: usageGoals.descriptions,
      recommendedIntelTools: usageGoals.recommendedIntelTools,
    },
    samples: {
      transactions: transactions.length,
      customers: customers.length,
      inventoryItems: inventory.length,
    },
    financialSignals: {
      unpaidTxCount: unpaidTx,
      partialPaymentTxCount: partialCount,
      distinctCustomersWithBalance: unpaidByCustomer.size,
      expensePhpLast7Days: Math.round(expense7d * 100) / 100,
      revenuePhpLast7Days: Math.round(revenue7d * 100) / 100,
      openDeliveryCount: openDeliveries,
    },
    topUnpaidCustomers: topUnpaid.map((u) => ({
      name: u.name,
      balancePhp: Math.round(u.balance * 100) / 100,
      openTxCount: u.txCount,
    })),
    deliveryBacklogSample: backlog,
    lowStockItems: lowStock,
    activeCustomerCount: customers.filter((c) => c.status !== "inactive")
      .length,
    dormantSignals,
    lowHealthSample,
    lowRatingSample,
    reminderQueue30,
    reminderQueue60,
    reminderQueue90,
    goalRelevantSignals:
      usageGoals.ids.length > 0 ?
        {
          salesFocus: goalIds.has("sales"),
          inventoryFocus: goalIds.has("inventory"),
          customersFocus: goalIds.has("customers"),
          deliveryFocus: goalIds.has("delivery"),
          expensesFocus: goalIds.has("expenses"),
          analyticsFocus: goalIds.has("analytics"),
        } :
        null,
  };
}

function ownerGoalsPromptBlock(goals: OwnerUsageGoalsContext): string {
  if (goals.ids.length === 0) {
    return (
      " No onboarding usage goals on file — give a balanced owner briefing across cash, " +
      "dispatch, inventory, and customers."
    );
  }

  const lines = goals.ids.map(
    (id, i) =>
      `- ${goals.labels[i]}: ${goals.descriptions[i]}`,
  );

  return (
    " The owner selected these workspace priorities during onboarding:\n" +
    `${lines.join("\n")}\n` +
    " Tailor tone and action items to these goals. Lead with what matters most to their " +
    "stated priorities; de-emphasize areas they did not select unless risk is high. " +
    `Recommended intel tools for their goals: ${goals.recommendedIntelTools.join(", ")}.`
  );
}

function systemPromptForTool(
  tool: AiToolId,
  goals: OwnerUsageGoalsContext,
): string {
  const common =
    "You are River AI, an operations copilot for water refilling station owners " +
    "in the Philippines. " +
    "Use ONLY the JSON facts provided — do not invent customers, amounts, or delivery IDs. " +
    "The JSON includes ownerUsageGoals from their business profile — honor those priorities. " +
    "Respond in clear English; short Filipino phrases are OK when natural. " +
    "Be practical and respectful. Output STRICT JSON with keys: title, summary, " +
    "highlights (array of strings, max 6), actionItems (array of {label, detail}, max 6), " +
    "riskLevel (\"low\"|\"medium\"|\"high\") based on operational pressure." +
    ownerGoalsPromptBlock(goals);

  const goalIds = new Set(goals.ids);
  const salesNote =
    goalIds.has("sales") ?
      " Emphasize revenuePhpLast7Days and collection rhythm." :
      "";
  const customersNote =
    goalIds.has("customers") ?
      " Name top suki accounts and concrete follow-up windows." :
      "";
  const deliveryNote =
    goalIds.has("delivery") ?
      " Prioritize openDeliveryCount and deliveryBacklogSample." :
      "";
  const inventoryNote =
    goalIds.has("inventory") ?
      " Lead with lowStockItems and reorder urgency." :
      "";
  const expensesNote =
    goalIds.has("expenses") ?
      " Reference expensePhpLast7Days vs collections when relevant." :
      "";
  const analyticsNote =
    goalIds.has("analytics") ?
      " Compare week-over-week signals and call out trends in highlights." :
      "";

  switch (tool) {
  case "morning_brief":
    return (
      `${common} Focus: one-screen owner brief — cash & AR posture, dispatch pressure, ` +
      "inventory risk, dormant suki retention (dormantSignals.dormantCount / byTier / sample), " +
      "suki health at risk (lowHealthSample — lowest scores, name only from JSON), " +
      `and one priority for today.${salesNote}${deliveryNote}` +
      `${inventoryNote}${expensesNote}${analyticsNote}${customersNote}`
    );
  case "collections_pulse":
    return (
      `${common} Focus: collections & accounts receivable — who owes, partial payments, ` +
      "and concrete follow-up cadence. Use reminderQueue30/60/90 only — never invent debtor names. " +
      "paymentReminderScripts in the snapshot are deterministic Taglish seeds — refine them in outreachPlan. " +
      "Return JSON with title, summary, highlights, actionItems, riskLevel, " +
      "and outreachPlan (array, max 12). Each outreachPlan item: name (exact match from reminder queues), " +
      "priority (high for 90d tier, medium for 60d, low for 30d), " +
      "reason (short — include tier, amountPhp, oldestDebtDays from JSON), " +
      "suggestedMessage (≤280 chars, friendly Taglish payment reminder / call script, no invented promos)." +
      `${customersNote}${salesNote}`
    );
  case "dispatch_health":
    return (
      `${common} Focus: fulfillment backlog — stalled deliveries, unpaid + in-flight risk, ` +
      `rider follow-ups.${deliveryNote}`
    );
  case "warehouse_risk":
    return (
      `${common} Focus: warehouse / SKU risk — low stock, implied refill demand from backlog ` +
      `context, reorder urgency.${inventoryNote}`
    );
  case "retention_pulse":
    return (
      `${common} Focus: dormant suki retention AND low-rating recovery. ` +
      "Use dormantSignals.sample for win-back scripts and lowRatingSample for apology/recovery scripts — " +
      "never invent customer names or phones. " +
      "Prioritize who to call today based on daysSilent, historicalOrders, " +
      "avgCadenceDays, cadenceLate, unpaidBalancePhp, and low ratings with feedback. " +
      "Return JSON with title, summary, highlights, actionItems, riskLevel, " +
      "and outreachPlan (array, max 12). " +
      "Each outreachPlan item: name (exact match from dormantSignals.sample OR lowRatingSample), " +
      "priority (high|medium|low), reason (short why today), " +
      "suggestedMessage (≤280 chars, friendly Taglish SMS/call script, no invented promos). " +
      "actionItems should include concrete call/SMS steps. Set riskLevel high when " +
      "dormantCount is rising vs vsPriorPeriodDormantCount or many churned-tier accounts." +
      `${customersNote}${analyticsNote}`
    );
  case "plant_health":
    return (
      `${common} Focus: plant operations — overdue preventive maintenance, ` +
      "today's production gallons vs sold refill units, and variance flags in plantHealth. " +
      "When productionVarianceActive is true, include varianceHypotheses (array of strings, max 5): " +
      "ranked plausible causes using ONLY plantHealth facts (unlogged walk-ins, open deliveries, " +
      "stale shift log, meter drift, leak) — no invented numbers. " +
      "When aiEnrichments.ai06_waterQualityAnomaly.anomalyActive is true, mention water quality trend " +
      "and include customerCommsDraft if present (suggested suki message — do not invent readings). " +
      "Give practical next steps (replace filter, log shift, reconcile walk-ins). " +
      "Use only plantHealth and maintenance task names from JSON — do not invent readings."
    );
  case "churn_risk":
    return (
      `${common} Focus: churn risk beyond dormant rules — use aiEnrichments.ai15_churnRisk sample. ` +
      "Explain top 5 at-risk suki with scores and drivers. No invented names."
    );
  case "dashboard_qa":
    return (
      `${common} Focus: answer owner dashboard questions from snapshot facts only. ` +
      "Be concise and cite numbers from JSON."
    );
  default:
    return common;
  }
}

export class AiToolRunService {
  static async listRuns(
    businessId: string,
    limit = 40,
  ): Promise<AiToolRunRecord[]> {
    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("ai_tool_runs")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt?.toDate ?
        d.createdAt.toDate().toISOString() :
        new Date().toISOString();
      return {
        id: doc.id,
        tool: d.tool as AiToolId,
        toolLabel: String(d.toolLabel || ""),
        title: String(d.title || ""),
        summary: String(d.summary || ""),
        highlights: Array.isArray(d.highlights) ? d.highlights : [],
        actionItems: Array.isArray(d.actionItems) ? d.actionItems : [],
        riskLevel: d.riskLevel || "low",
        outreachPlan: parseStoredOutreachPlan(d.outreachPlan),
        dataSnapshot: (d.dataSnapshot && typeof d.dataSnapshot === "object" ?
          d.dataSnapshot :
          {}) as Record<string, unknown>,
        createdAt,
        createdByUid: String(d.createdByUid || ""),
        aiModel: String(d.aiModel || DEFAULT_GEMINI_MODEL),
      };
    });
  }

  static async executeTool(params: {
    businessId: string;
    uid: string;
    tool: string;
    scheduledAuto?: boolean;
    scheduledDateKey?: string;
  }): Promise<AiToolRunRecord> {
    const { businessId, uid, tool, scheduledAuto = false, scheduledDateKey } =
      params;
    if (!isAiToolId(tool)) {
      throw new Error("INVALID_TOOL");
    }

    const [transactions, customers, inventoryItems, businessSnap] =
      await Promise.all([
        TransactionService.getTransactionsByBusiness(businessId, {
          limit: 120,
        }),
        CustomerService.getCustomersByBusiness(businessId).then((rows) =>
          rows.slice(0, 150),
        ),
        InventoryService.listItems(businessId).then((rows) =>
          rows.slice(0, 80),
        ),
        db.collection("businesses").doc(businessId).get(),
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

    if (tool === "plant_health") {
      const plantFacts = await buildPlantHealthFacts(
        businessId,
        transactions,
        uiConfig,
        now,
      );
      Object.assign(snapshot, plantFacts);
      const variance = buildVarianceRootCauseFacts(
        (snapshot.plantHealth || {}) as Record<string, unknown>,
      );
      if (variance.active) {
        (snapshot.plantHealth as Record<string, unknown>).varianceHypotheses =
          variance.hypotheses;
      }
      const wq = await buildWaterQualityAnomalyFacts(businessId);
      if (wq) {
        (snapshot.plantHealth as Record<string, unknown>).waterQualityAnomaly = wq;
      }
    }

    if (tool === "collections_pulse") {
      snapshot.paymentReminderScripts = buildPaymentReminderScripts(snapshot);
    }

    await enrichAiToolSnapshot(tool, snapshot, {
      businessId,
      businessName,
      transactions,
      customers,
      inventory: inventoryItems,
      uiConfig,
      now,
    });

    const modelErrorSummary =
      "River AI could not reach the model right now. Your live counts are still saved in the " +
      "snapshot below — try again shortly.";
    const missingKeySummary =
      "River AI is not configured on this server. For local development, add GEMINI_API_KEY to " +
      "backend/functions/.env and restart the API emulator.";
    const fallbackSummary = getGeminiApiKey() ?
      modelErrorSummary :
      missingKeySummary;

    const ai = await geminiGenerateJson<AiToolRunOutput>({
      system: systemPromptForTool(tool, usageGoals),
      user: `Tool: ${tool}\nFacts JSON:\n${JSON.stringify(snapshot, null, 2)}`,
      fallback: normalizeGeminiOutput(null, fallbackSummary),
    });

    const normalized = normalizeGeminiOutput(ai, fallbackSummary);
    let outreachPlan =
      tool === "retention_pulse" ?
        normalizeOutreachPlan(
          ai?.outreachPlan,
          retentionOutreachNameKeys(snapshot),
        ) :
        tool === "collections_pulse" ?
          normalizeOutreachPlan(
            ai?.outreachPlan,
            paymentReminderNameKeys(snapshot),
          ) :
          undefined;

    if (tool === "collections_pulse" && (!outreachPlan || outreachPlan.length === 0)) {
      const fallback = buildCollectionsOutreachFallback(snapshot);
      outreachPlan = fallback.length > 0 ? fallback : undefined;
    }

    const doc = {
      tool,
      toolLabel: toolLabel(tool),
      title: normalized.title,
      summary: normalized.summary,
      highlights: normalized.highlights,
      actionItems: normalized.actionItems,
      riskLevel: normalized.riskLevel,
      ...(outreachPlan && outreachPlan.length > 0 ? { outreachPlan } : {}),
      dataSnapshot: snapshot,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: uid,
      aiModel: getGeminiModel(),
      ...(scheduledAuto ? { scheduledAuto: true } : {}),
      ...(scheduledDateKey ? { scheduledDateKey } : {}),
    };

    const ref = await db
      .collection("businesses")
      .doc(businessId)
      .collection("ai_tool_runs")
      .add(doc);

    logger.info("ai_tool_run created", { businessId, tool, runId: ref.id });

    return {
      id: ref.id,
      tool,
      toolLabel: doc.toolLabel,
      ...normalized,
      ...(outreachPlan && outreachPlan.length > 0 ? { outreachPlan } : {}),
      dataSnapshot: snapshot,
      createdAt: new Date().toISOString(),
      createdByUid: uid,
      aiModel: doc.aiModel,
    };
  }
}
