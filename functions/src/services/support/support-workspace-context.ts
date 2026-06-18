import { db } from "../../config/firebase-admin";
import {
  DEFAULT_GETTING_STARTED,
  type GettingStartedKey,
} from "../business/business-onboarding-defaults";
import {
  detectGettingStartedFromCollections,
} from "../business/getting-started-sync-service";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { CustomerService, type Customer } from "../customers/customer-service";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import { buildPaymentReminderQueue } from "../../utils/payment-reminder-queue";
import type { SupportAiTurnResult, SupportStructuredReply } from "./support-chat-types";
import { structuredReplyToPlainText } from "./support-structured-reply";

export type SupportWorkspaceOpsSnapshot = {
  dormantCount: number;
  unpaidTotalPhp: number;
  openDeliveryCount: number;
  revenuePhpLast7Days: number;
  callTodayCount: number;
};

export type SupportWorkspaceContext = {
  businessName: string;
  gettingStarted: Record<GettingStartedKey, boolean>;
  activeRiderCount: number;
  ops: SupportWorkspaceOpsSnapshot;
};

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

function buildOpsSnapshot(
  transactions: Transaction[],
  customers: Customer[],
  now: Date,
): SupportWorkspaceOpsSnapshot {
  const sevenAgo = new Date(now.getTime() - 7 * 86400000);
  let revenue7d = 0;
  let openDeliveries = 0;

  for (const tx of transactions) {
    if (tx.type === "expense") continue;
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
  }

  const dormantSignals = buildDormantSignalsSnapshot(customers, transactions, now);
  const debt = computeDebtAgingBreakdown(transactions, customers);
  const unpaidTotalPhp = Math.round(
    debt.rows.reduce((sum, row) => sum + row.amount, 0) * 100,
  ) / 100;
  const callTodayCount = buildPaymentReminderQueue(debt.rows, customers, {
    paymentReminderEnabled: true,
    paymentReminder30Enabled: true,
    paymentReminder60Enabled: true,
    paymentReminder90Enabled: true,
  }, now).length;

  return {
    dormantCount: Number(dormantSignals.dormantCount ?? 0),
    unpaidTotalPhp,
    openDeliveryCount: openDeliveries,
    revenuePhpLast7Days: Math.round(revenue7d * 100) / 100,
    callTodayCount,
  };
}

export async function loadSupportWorkspaceContext(
  businessId: string,
): Promise<SupportWorkspaceContext> {
  const bizRef = db.collection("businesses").doc(businessId);
  const now = new Date();
  const [bizSnap, detected, membersSnap, transactions, customers] = await Promise.all([
    bizRef.get(),
    detectGettingStartedFromCollections(businessId),
    bizRef.collection("members").limit(40).get(),
    TransactionService.getTransactionsByBusiness(businessId, { limit: 120 }),
    CustomerService.getCustomersByBusiness(businessId).then((rows) => rows.slice(0, 150)),
  ]);

  let activeRiderCount = 0;
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    if (data.isActive === false) continue;
    if (String(data.role || "").toLowerCase() === "rider") activeRiderCount++;
  }

  const gettingStarted: Record<GettingStartedKey, boolean> = { ...DEFAULT_GETTING_STARTED };
  for (const key of Object.keys(DEFAULT_GETTING_STARTED) as GettingStartedKey[]) {
    if (detected[key] === true) gettingStarted[key] = true;
  }

  return {
    businessName: String(bizSnap.data()?.name || "your station").trim(),
    gettingStarted,
    activeRiderCount,
    ops: buildOpsSnapshot(transactions, customers, now),
  };
}

export function formatSupportWorkspaceContextBlock(
  ctx: SupportWorkspaceContext,
): string {
  const { ops } = ctx;
  const lines = [
    "## Live workspace snapshot (authoritative — read BEFORE giving app steps)",
    `- Business name: ${ctx.businessName}`,
    `- Has at least one customer: ${ctx.gettingStarted.addCustomer ? "yes" : "NO — prerequisite missing"}`,
    `- Has recorded a delivery before: ${ctx.gettingStarted.addDelivery ? "yes" : "no"}`,
    `- Has recorded a collection before: ${ctx.gettingStarted.addCollection ? "yes" : "no"}`,
    `- Has inventory items: ${ctx.gettingStarted.addInventory ? "yes" : "no"}`,
    `- Has payment account on file: ${ctx.gettingStarted.addPaymentAccount ? "yes" : "no"}`,
    `- Active riders on team: ${ctx.activeRiderCount}`,
    "",
    "### Today's operational numbers (use when owner asks how the station is doing)",
    `- Dormant sukis (7+ days silent): ${ops.dormantCount}`,
    `- Total unpaid balance (PHP): ${ops.unpaidTotalPhp}`,
    `- Open / in-flight deliveries: ${ops.openDeliveryCount}`,
    `- Revenue last 7 days (PHP): ${ops.revenuePhpLast7Days}`,
    `- Call-today payment reminders queued: ${ops.callTodayCount}`,
    "",
    "### Prerequisite rules (required)",
    "- If user asks about **delivery** or **collection** but **no customer yet**, do NOT jump to Transactions steps.",
    "  Encourage them warmly in Taglish to **Add Customer** first (Customers page → Add Customer).",
    "  Then explain they can return to Transactions → Add Delivery / Add Collection.",
    "- If user asks to **assign a rider** but **active riders = 0**, tell them to invite a rider via **Team Hub** first (Grow+ plan).",
    "- If user asks about **inventory-linked** actions but **no inventory**, suggest **Inventory** setup first.",
    "- When a prerequisite is missing, set a **warning** badge like \"Setup needed\" and put the fix in **steps[]**.",
    "- When prerequisites are satisfied, give the normal workflow steps.",
    "- When owner asks **how am I doing** / **kumusta ang station**, lead with the operational numbers above in **highlights**.",
  ];
  return lines.join("\n");
}

function mentionsDeliveryOrCollection(text: string): boolean {
  const lower = text.toLowerCase();
  const deliveryish =
    lower.includes("delivery") ||
    lower.includes("deliver") ||
    lower.includes("padala") ||
    lower.includes("hatid") ||
    /mag-record.*deliver|record.*delivery|paano mag.*deliver/i.test(lower);
  const collectionish =
    lower.includes("collection") ||
    lower.includes("pickup") ||
    lower.includes("koleksyon");
  return deliveryish || collectionish;
}

function mentionsRiderAssignment(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("rider") || lower.includes("my area")) &&
    (lower.includes("assign") ||
      lower.includes("i-assign") ||
      lower.includes("walang rider") ||
      lower.includes("no rider"))
  );
}

function mentionsInventorySetup(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("inventory") || lower.includes("stock") || lower.includes("container")) &&
    (lower.includes("add") ||
      lower.includes("setup") ||
      lower.includes("record") ||
      lower.includes("paano"))
  );
}

const STATION_HEALTH_OVERVIEW_RE = new RegExp(
  [
    "how am i doing",
    "how'?s my station",
    "station status",
    "business health",
    "kumusta ang station",
    "kumusta ang negosyo",
    "anong status",
    "overview ngayon",
    "summary ngayon",
    "paano na ang",
  ].join("|"),
  "i",
);

function mentionsStationHealth(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    STATION_HEALTH_OVERVIEW_RE.test(lower) ||
    (lower.includes("dormant") && (lower.includes("how many") || lower.includes("ilan"))) ||
    (lower.includes("utang") && lower.includes("magkano"))
  );
}

function finishPrerequisiteTurn(
  structured: SupportStructuredReply,
  overrides: Partial<SupportAiTurnResult> = {},
): SupportAiTurnResult {
  return {
    reply: structuredReplyToPlainText(structured),
    structured,
    askSatisfaction: true,
    suggestHuman: false,
    suggestResolve: false,
    detectedSatisfied: false,
    detectedDissatisfied: false,
    detectedHumanRequest: false,
    topicOutOfScope: false,
    ...overrides,
  };
}

function formatPhp(amount: number): string {
  return amount.toLocaleString("en-PH", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** AI-45: deterministic station health card from live ops snapshot. */
export function buildWorkspaceHealthTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  if (!mentionsStationHealth(userText)) return null;

  const { ops } = ctx;
  const highlights: NonNullable<SupportStructuredReply["highlights"]> = [
    {
      title: "Dormant sukis",
      body:
        ops.dormantCount > 0 ?
          `May **${ops.dormantCount}** active suki na 7+ araw nang walang order — tingnan sa **Forecast → Dormant** tab.` :
          "Walang dormant suki ngayon — magandang retention signal.",
      variant: ops.dormantCount > 0 ? "warning" : "tip",
    },
    {
      title: "Utang / AR",
      body:
        ops.unpaidTotalPhp > 0 ?
          `Kabuuang utang: **₱${formatPhp(ops.unpaidTotalPhp)}**` +
          (ops.callTodayCount > 0 ?
            ` · **${ops.callTodayCount}** suki sa call-today list` :
            "") :
          "Walang outstanding balance sa recent transactions.",
      variant: ops.unpaidTotalPhp > 0 ? "action" : "tip",
    },
    {
      title: "Dispatch & sales",
      body:
        `**${ops.openDeliveryCount}** open delivery` +
        (ops.openDeliveryCount === 1 ? "" : "ies") +
        ` · **₱${formatPhp(ops.revenuePhpLast7Days)}** revenue (7 araw).`,
      variant: "note",
    },
  ];

  const steps: NonNullable<SupportStructuredReply["steps"]> = [];
  if (ops.dormantCount > 0) {
    steps.push({
      title: "Buksan ang **Forecast → Dormant** para makita kung sino ang i-call",
      priority: "high",
      tags: ["Forecast"],
    });
  }
  if (ops.callTodayCount > 0) {
    steps.push({
      title: "Sa **Command Center → Unpaid**, gamitin ang **Call today** list",
      priority: "high",
      tags: ["Collections"],
    });
  }
  if (ops.openDeliveryCount > 0) {
    steps.push({
      title: `I-follow up ang **${ops.openDeliveryCount}** open delivery sa **Transactions**`,
      priority: "medium",
      tags: ["Transactions"],
    });
  }
  if (steps.length === 0) {
    steps.push({
      title: "Mag-log ng bagong delivery o collection para mas updated ang snapshot",
      priority: "medium",
      tags: ["Transactions"],
    });
  }

  return finishPrerequisiteTurn({
    sectionLabel: "SAGOT",
    summary:
      `Ito ang mabilis na snapshot ng **${ctx.businessName}** ngayon — base sa live data ng workspace mo.`,
    badges: [{ label: "Live snapshot", tone: "info" }],
    highlights,
    steps,
  });
}

/** Deterministic guidance when workspace data shows a missing prerequisite. */
export function buildWorkspacePrerequisiteTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  const healthTurn = buildWorkspaceHealthTurn(userText, ctx);
  if (healthTurn) return healthTurn;

  if (!ctx.gettingStarted.addCustomer && mentionsDeliveryOrCollection(userText)) {
    return finishPrerequisiteTurn({
      sectionLabel: "SAGOT",
      summary:
        "Mukhang **wala ka pang customer** sa workspace mo. Kailangan mo munang mag-add ng customer " +
        "bago makapag-record ng delivery o collection — naka-link kasi ang bawat order sa customer profile.",
      badges: [{ label: "Setup needed", tone: "warning" }],
      highlights: [
        {
          title: "Una muna: customer profile",
          body:
            "Ilagay ang pangalan, phone, at address ng suki — doon naka-base ang delivery, collection, at balance.",
          variant: "tip",
        },
      ],
      steps: [
        {
          title: "Pumunta sa **Customers** page sa dashboard",
          priority: "high",
          tags: ["Customers"],
        },
        {
          title: "I-click **Add Customer** at punan ang name, phone, at delivery address",
          priority: "high",
          tags: ["Customers"],
        },
        {
          title: "Pag may customer na, balik sa **Transactions → Add Delivery** (o Add Collection)",
          priority: "medium",
          tags: ["Transactions"],
        },
      ],
    });
  }

  if (
    ctx.activeRiderCount === 0 &&
    mentionsRiderAssignment(userText) &&
    ctx.gettingStarted.addCustomer
  ) {
    return finishPrerequisiteTurn({
      sectionLabel: "SAGOT",
      summary:
        "Wala pang **active rider** sa team mo. Mag-invite muna ng rider sa **Team Hub** (Grow plan pataas) " +
        "bago ka mag-assign ng delivery jobs.",
      badges: [{ label: "Team setup", tone: "warning" }],
      steps: [
        {
          title: "Profile menu → **Team Hub** → Invite",
          body: "Piliin ang role na Rider / Operator.",
          priority: "high",
          tags: ["Team Hub"],
        },
        {
          title: "Hintayin ang teammate na tanggapin ang invite at mag-onboard",
          priority: "medium",
          tags: ["Team Hub"],
        },
        {
          title: "Balik sa **Transactions** para i-assign ang rider sa delivery",
          priority: "medium",
          tags: ["Transactions"],
        },
      ],
    });
  }

  if (!ctx.gettingStarted.addInventory && mentionsInventorySetup(userText)) {
    return finishPrerequisiteTurn({
      sectionLabel: "SAGOT",
      summary:
        "Mukhang wala pang **inventory items** sa workspace mo. Mag-setup muna ng containers, caps, o stock " +
        "sa **Inventory** page para ma-track ang gallons at containers nang maayos.",
      badges: [{ label: "Setup needed", tone: "warning" }],
      steps: [
        {
          title: "Buksan ang **Inventory** page",
          priority: "high",
          tags: ["Inventory"],
        },
        {
          title: "I-add ang items na ginagamit mo (containers, caps, etc.)",
          priority: "high",
          tags: ["Inventory"],
        },
      ],
    });
  }

  return null;
}
