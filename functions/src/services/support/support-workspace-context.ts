import {
  buildBusinessBuddySnapshot,
  formatBusinessBuddyContextBlock,
  loadBusinessBuddyFirestoreData,
  type BusinessBuddySnapshot,
  type BuddyScheduleStop,
} from "./business-buddy-snapshot";
import type { WorkspaceRevenueMetrics } from "../../utils/ledger-collected-revenue";
import type { GettingStartedKey } from "../business/business-onboarding-defaults";
import type { SupportAiTurnResult, SupportStructuredReply } from "./support-chat-types";
import { structuredReplyToPlainText } from "./support-structured-reply";

export type SupportWorkspaceOpsSnapshot = BusinessBuddySnapshot["ops"] & {
  revenuePhpLast7Days: number;
  revenue: WorkspaceRevenueMetrics;
};

export type SupportWorkspaceContext = {
  businessName: string;
  gettingStarted: Record<GettingStartedKey, boolean>;
  activeRiderCount: number;
  ops: SupportWorkspaceOpsSnapshot;
  buddy: BusinessBuddySnapshot;
};

export async function loadSupportWorkspaceContext(
  businessId: string,
): Promise<SupportWorkspaceContext> {
  const data = await loadBusinessBuddyFirestoreData(businessId);
  const buddy = buildBusinessBuddySnapshot(data);
  return {
    businessName: data.businessName,
    gettingStarted: data.gettingStarted,
    activeRiderCount: data.activeRiderCount,
    buddy,
    ops: {
      ...buddy.ops,
      revenuePhpLast7Days: buddy.revenue.last7DaysPhp,
      revenue: buddy.revenue,
    },
  };
}

export function formatSupportWorkspaceContextBlock(
  ctx: SupportWorkspaceContext,
): string {
  const prerequisiteBlock = [
    "### Prerequisite rules (required)",
    "- If user asks about **delivery** or **collection** but **no customer yet**, do NOT jump to Transactions steps.",
    "  Encourage them warmly in Taglish to **Add Customer** first (Customers page → Add Customer).",
    "- If user asks to **assign a rider** but **active riders = 0**, tell them to invite a rider via **Team Hub** first (Grow+ plan).",
    "- If user asks about **inventory-linked** actions but **no inventory**, suggest **Inventory** setup first.",
    "- When a prerequisite is missing, set a **warning** badge like \"Setup needed\" and put the fix in **steps[]**.",
    "- When owner asks **how am I doing** / **kumusta ang station**, lead with operational + revenue numbers in **highlights**.",
  ].join("\n");

  return `${formatBusinessBuddyContextBlock(ctx.buddy, ctx.gettingStarted, ctx.activeRiderCount)}\n\n${prerequisiteBlock}`;
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
    (lower.includes("utang") && lower.includes("magkano") && !mentionsRevenueQuestion(text))
  );
}

const REVENUE_QUESTION_RE = new RegExp(
  [
    "magkano.*(kita|kinita|earnings|revenue|sales|benta|sale)",
    "(kita|kinita|earnings|revenue|sales|benta).*(ngayon|today|kahapon|yesterday|linggo|week|araw)",
    "how much.*(earn|made|collect|revenue|sales|sale)",
    "kumita.*(ngayon|today|kahapon|yesterday)",
    "sales (today|yesterday|kahapon|ngayon)",
    "kita ko (ngayon|kahapon)",
    "kinita ko (ngayon|kahapon)",
    "my sales",
    "total sales",
    "gross sales",
  ].join("|"),
  "i",
);

const UNPAID_QUESTION_RE = new RegExp(
  [
    "magkano.*(utang|balance|outstanding|collectible)",
    "(utang|balance due|outstanding).*(magkano|how much|total)",
    "how much.*(owe|outstanding|unpaid|collect)",
  ].join("|"),
  "i",
);

const FORECAST_RE = new RegExp(
  [
    "forecast",
    "predik",
    "prediction",
    "project",
    "estimate",
    "susunod na linggo",
    "next week",
    "future sales",
    "magkano.*(kita|kinita).*(next|susunod|linggo|week)",
    "tataas ba",
    "bababa ba",
  ].join("|"),
  "i",
);

type RevenuePeriod = "today" | "yesterday" | "last7days";

function mentionsRevenueQuestion(text: string): boolean {
  return REVENUE_QUESTION_RE.test(text);
}

function mentionsUnpaidQuestion(text: string): boolean {
  return UNPAID_QUESTION_RE.test(text);
}

function mentionsForecast(text: string): boolean {
  return FORECAST_RE.test(text);
}

function resolveRevenuePeriod(text: string): RevenuePeriod {
  const lower = text.toLowerCase();
  if (
    lower.includes("kahapon") ||
    lower.includes("yesterday") ||
    /sales yesterday|earn.*yesterday/i.test(lower)
  ) {
    return "yesterday";
  }
  if (
    lower.includes("7 araw") ||
    lower.includes("last 7") ||
    lower.includes("last week") ||
    lower.includes("this week") ||
    lower.includes("linggong") ||
    (lower.includes("linggo") && !lower.includes("susunod") && !lower.includes("next"))
  ) {
    return "last7days";
  }
  return "today";
}

function revenueAmountForPeriod(
  revenue: WorkspaceRevenueMetrics,
  period: RevenuePeriod,
): number {
  if (period === "yesterday") return revenue.yesterdayPhp;
  if (period === "last7days") return revenue.last7DaysPhp;
  return revenue.todayPhp;
}

function periodLabelTaglish(period: RevenuePeriod): string {
  if (period === "yesterday") return "kahapon";
  if (period === "last7days") return "sa nakaraang 7 araw";
  return "ngayon";
}

function periodFilterLabel(period: RevenuePeriod): string {
  if (period === "yesterday") return "Yesterday";
  if (period === "last7days") return "This week";
  return "Today";
}

function personalRevenueSummary(
  period: RevenuePeriod,
  amount: number,
  businessName: string,
): string {
  const when = periodLabelTaglish(period);
  if (amount <= 0) {
    return (
      `Sa records mo sa **${businessName}**, wala pang naka-log na collected payment **${when}** — ` +
      "baka may hindi pa na-record na bayad, o talagang walang sale sa period na yun."
    );
  }
  return (
    `**Kumita ka ng ₱${formatPhp(amount)} ${when}** sa **${businessName}** — ` +
    "base sa collected payments na naka-log na sa Smart Refill mo."
  );
}

function appGuideStepForRevenue(period: RevenuePeriod): NonNullable<SupportStructuredReply["steps"]>[number] {
  const filter = periodFilterLabel(period);
  return {
    title: `Upang makita ito sa app: buksan ang **Transactions** → time filter **${filter}**`,
    body: "Doon makikita mo ang breakdown per payment (Cash, GCash, etc.) at individual rows.",
    priority: "medium",
    tags: ["Transactions"],
  };
}

function formatBreakdownTip(
  revenue: WorkspaceRevenueMetrics,
  period: RevenuePeriod,
): string | null {
  if (period !== "today") return null;
  const { cashPhp, onlinePhp } = revenue.todayBreakdown;
  if (revenue.todayPhp <= 0) return null;
  const parts: string[] = [];
  if (cashPhp > 0) parts.push(`Cash ₱${formatPhp(cashPhp)}`);
  if (onlinePhp > 0) parts.push(`Online ₱${formatPhp(onlinePhp)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildRevenueContextHighlights(
  period: RevenuePeriod,
  revenue: WorkspaceRevenueMetrics,
): NonNullable<SupportStructuredReply["highlights"]> {
  const highlights: NonNullable<SupportStructuredReply["highlights"]> = [];
  const breakdown = formatBreakdownTip(revenue, period);

  if (period === "today" && breakdown) {
    highlights.push({
      title: "Breakdown ngayon",
      body: breakdown,
      variant: "note",
    });
  }

  if (period !== "yesterday" && revenue.yesterdayPhp > 0) {
    highlights.push({
      title: "Para sa comparison",
      body: `Kahapon: **₱${formatPhp(revenue.yesterdayPhp)}** · Last 7 days: **₱${formatPhp(revenue.last7DaysPhp)}**.`,
      variant: "note",
    });
  } else if (period === "yesterday" && revenue.todayPhp > 0) {
    highlights.push({
      title: "Para sa comparison",
      body: `Ngayon (so far): **₱${formatPhp(revenue.todayPhp)}** · Last 7 days: **₱${formatPhp(revenue.last7DaysPhp)}**.`,
      variant: "note",
    });
  }

  if (period === "today" && revenue.expensesTodayPhp > 0) {
    highlights.push({
      title: "Net ngayon",
      body:
        `Expenses today: **₱${formatPhp(revenue.expensesTodayPhp)}** · Net: **₱${formatPhp(revenue.netTodayPhp)}**.`,
      variant: "note",
    });
  }

  return highlights;
}

function buildRevenueTips(ctx: SupportWorkspaceContext): NonNullable<SupportStructuredReply["highlights"]> {
  const tips: NonNullable<SupportStructuredReply["highlights"]> = [];
  if (ctx.ops.unpaidTotalPhp > 0) {
    tips.push({
      title: "Tip para sa iyo",
      body:
        `May **₱${formatPhp(ctx.ops.unpaidTotalPhp)}** pa na outstanding — follow-up mo ang suki sa **Command Center → Unpaid** para tumaas ang kita.`,
      variant: "tip",
    });
  } else if (ctx.ops.dormantCount > 0) {
    tips.push({
      title: "Tip para sa iyo",
      body:
        `**${ctx.ops.dormantCount}** dormant suki ang pwede mong i-call — mabilis na follow-up, posibleng dagdag sales.`,
      variant: "tip",
    });
  } else {
    tips.push({
      title: "Tip para sa iyo",
      body: "I-log agad ang bawat payment sa Transactions para accurate ang figures mo bukas.",
      variant: "tip",
    });
  }
  return tips;
}

function formatScheduleStopLine(stop: BuddyScheduleStop): string {
  const gallons = stop.gallons > 0 ? ` · ${stop.gallons} gal` : "";
  const rider = stop.riderName ? ` · ${stop.riderName}` : "";
  return `**${stop.customerName}** (${stop.type}, ${stop.deliveryStatus}${gallons}${rider})`;
}

const DELIVERY_SCHEDULE_RE = new RegExp(
  [
    "sino.*(deliver|hatid|padala|refill)",
    "(deliver|hatid|padala|refill).*(bukas|tomorrow|sino|kanino|who)",
    "whom should i deliver",
    "who should i deliver",
    "delivery.*(bukas|tomorrow|schedule|list)",
    "schedule.*(delivery|refill|bukas|tomorrow)",
    "kanino.*(hatid|deliver)",
    "listahan.*(delivery|hatid|bukas)",
  ].join("|"),
  "i",
);

function mentionsDeliverySchedule(text: string): boolean {
  return DELIVERY_SCHEDULE_RE.test(text);
}

function resolveScheduleFocus(text: string): "tomorrow" | "week" {
  const lower = text.toLowerCase();
  if (lower.includes("bukas") || lower.includes("tomorrow")) return "tomorrow";
  return "week";
}

/** Who to deliver/refill tomorrow (or this week) from live transaction schedule. */
export function buildWorkspaceScheduleTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  if (!mentionsDeliverySchedule(userText)) return null;

  const focus = resolveScheduleFocus(userText);
  const stops =
    focus === "tomorrow" ?
      ctx.buddy.schedule.tomorrow :
      ctx.buddy.schedule.next7Days;

  const periodLabel = focus === "tomorrow" ? "bukas" : "sa susunod na 7 araw";
  let summary: string;
  const highlights: NonNullable<SupportStructuredReply["highlights"]> = [];

  if (stops.length === 0) {
    summary =
      `Wala kang naka-schedule na open delivery/collection **${periodLabel}** sa Firestore records mo. ` +
      "Baka kailangan mo munang mag-**Add Delivery** o i-accept ang portal orders.";
    if (ctx.buddy.cadenceLateSuki.length > 0) {
      const names = ctx.buddy.cadenceLateSuki
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ");
      highlights.push({
        title: "Proactive refill candidates",
        body:
          `May **${ctx.buddy.cadenceLateSuki.length}** suki na late vs usual pattern: ${names}. ` +
          "Pwede mo silang i-schedule kahit wala pa sa ledger bukas.",
        variant: "tip",
      });
    }
  } else {
    const preview = stops
      .slice(0, 8)
      .map(formatScheduleStopLine)
      .join("; ");
    const extra = stops.length > 8 ? ` at ${stops.length - 8} pa` : "";
    summary =
      `May **${stops.length}** open stop ka **${periodLabel}**: ${preview}${extra}.`;
    highlights.push({
      title: "Sa ledger mo",
      body: stops
        .slice(0, 12)
        .map(
          (stop) =>
            `${stop.customerName} — ${stop.referenceId || "ref n/a"} · ${stop.scheduledDay}`,
        )
        .join(" · "),
      variant: "note",
    });
  }

  if (ctx.buddy.pendingPortalOrders.length > 0) {
    highlights.push({
      title: "Pending portal orders",
      body:
        `May **${ctx.buddy.pendingPortalOrders.length}** portal submission na pending review — ` +
        "i-accept mo sa **Submissions** bago maging official delivery.",
      variant: "action",
    });
  }

  return finishPrerequisiteTurn({
    sectionLabel: "SAGOT",
    summary,
    badges: [{ label: "Live schedule", tone: "info" }],
    highlights: highlights.length > 0 ? highlights : undefined,
    steps: [
      {
        title:
          focus === "tomorrow" ?
            "Upang makita sa app: **Transactions** → filter **Upcoming** o **Tomorrow**" :
            "Upang makita sa app: **Transactions** → **This week** / **Upcoming**",
        body: "Pwede mo ring buksan ang **Command Center → Proactive → Scheduled** tab.",
        priority: "medium",
        tags: ["Transactions"],
      },
    ],
  });
}

/** Direct data answer + app guide for sales / kinita questions (any period). */
export function buildWorkspaceRevenueTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  if (!mentionsRevenueQuestion(userText)) return null;

  const period = resolveRevenuePeriod(userText);
  const { revenue } = ctx.ops;
  const amount = revenueAmountForPeriod(revenue, period);
  const summary = personalRevenueSummary(period, amount, ctx.businessName);

  return finishPrerequisiteTurn({
    sectionLabel: "SAGOT",
    summary,
    badges: [{ label: "Live data", tone: "info" }],
    highlights: [...buildRevenueContextHighlights(period, revenue), ...buildRevenueTips(ctx)],
    steps: [appGuideStepForRevenue(period)],
  });
}

/** Personal answer for outstanding balance questions. */
export function buildWorkspaceUnpaidTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  if (!mentionsUnpaidQuestion(userText)) return null;

  const amount = ctx.ops.unpaidTotalPhp;
  const summary =
    amount > 0 ?
      `May **₱${formatPhp(amount)}** kang outstanding balance sa **${ctx.businessName}** ` +
      "base sa recent transactions — ito ang hindi pa fully na-collect." :
      `Walang outstanding balance sa records mo ngayon sa **${ctx.businessName}** — updated ang collections mo.`;

  const steps: NonNullable<SupportStructuredReply["steps"]> = [
    {
      title: "Upang makita sa app: **Command Center** → **Unpaid balance** card → See list",
      body: "Pwede mong i-tap ang customer para mag-record ng payment.",
      priority: "medium",
      tags: ["Command Center"],
    },
  ];

  if (ctx.ops.callTodayCount > 0) {
    steps.unshift({
      title: `May **${ctx.ops.callTodayCount}** suki sa **Call today** list — priority mo sila ngayon`,
      priority: "high",
      tags: ["Collections"],
    });
  }

  return finishPrerequisiteTurn({
    sectionLabel: "SAGOT",
    summary,
    badges: [{ label: "Live data", tone: amount > 0 ? "warning" : "success" }],
    highlights:
      amount > 0 && ctx.ops.dormantCount > 0 ?
        [{
          title: "Tip para sa iyo",
          body: "Close AR muna — mas malaki ang impact kaysa sa bagong walk-in sales.",
          variant: "tip",
        }] :
        undefined,
    steps,
  });
}

/** Light forecast from recent daily average — not a guarantee. */
export function buildWorkspaceForecastTurn(
  userText: string,
  ctx: SupportWorkspaceContext,
): SupportAiTurnResult | null {
  if (!mentionsForecast(userText)) return null;

  const { revenue } = ctx.ops;
  const trend =
    revenue.trendVsPriorWeekPct == null ?
      "Kulang pa ang prior-week data para sa trend %" :
      `${revenue.trendVsPriorWeekPct > 0 ? "mas mataas" : revenue.trendVsPriorWeekPct < 0 ? "mas mababa" : "pareho"} ng ~${Math.abs(revenue.trendVsPriorWeekPct)}% vs nakaraang 7 araw`;

  return finishPrerequisiteTurn({
    sectionLabel: "SAGOT",
    summary:
      "Rough forecast lang ito para sa **iyo** — from average daily collections ng last 7 days. Hindi guarantee, pero useful guide sa planning.",
    badges: [{ label: "Forecast", tone: "info" }],
    highlights: [
      {
        title: "Susunod na 7 araw (estimate)",
        body:
          `Kung magpapatuloy ang recent pace: mga **₱${formatPhp(revenue.forecastNext7DaysPhp)}** collected revenue. ` +
          `Average per day: **₱${formatPhp(revenue.dailyAvgLast7DaysPhp)}**. ${trend}.`,
        variant: "action",
      },
      {
        title: "Tip",
        body:
          "Para tumaas ang forecast: follow-up sa dormant suki, close outstanding AR, at i-complete ang open deliveries on time.",
        variant: "tip",
      },
    ],
    evidence:
      "Projection = (last 7 days collected revenue ÷ 7) × 7. Based on payment dates in your ledger.",
  });
}

/** Wrap structured buddy replies for the support chat pipeline. */
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
  const { revenue } = ops;
  const todayLine =
    revenue.todayPhp > 0 ?
      `Kumita ka ng **₱${formatPhp(revenue.todayPhp)} ngayon** (so far). ` :
      "";

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
        ` · **₱${formatPhp(revenue.todayPhp)}** collected today · **₱${formatPhp(ops.revenuePhpLast7Days)}** (7 araw).`,
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
      `${todayLine}Ito ang personal snapshot ng **${ctx.businessName}** — base sa live data ng negosyo mo.`,
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
  const revenueTurn = buildWorkspaceRevenueTurn(userText, ctx);
  if (revenueTurn) return revenueTurn;

  const scheduleTurn = buildWorkspaceScheduleTurn(userText, ctx);
  if (scheduleTurn) return scheduleTurn;

  const unpaidTurn = buildWorkspaceUnpaidTurn(userText, ctx);
  if (unpaidTurn) return unpaidTurn;

  const forecastTurn = buildWorkspaceForecastTurn(userText, ctx);
  if (forecastTurn) return forecastTurn;

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
