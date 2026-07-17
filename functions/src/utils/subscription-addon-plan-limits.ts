/**
 * Maps `subscription_plans.limitations` (Firestore) to capped quotas so
 * catalog add-ons can be shown only when they extend a finite plan limit.
 * Supports legacy typo `cutomers` alongside `customers`.
 */
import type { ChannelUsageQuotas } from "./channel-usage-types";
import { parseChannelUsageQuotas } from "./channel-usage-plan-limits";

export type AddonLimitationExtension =
  | "staff_rider"
  | "staff_admin"
  | "ai_tools"
  | "customers"
  | "transactions_daily"
  | "online_orders"
  | "extra_business"
  | "none";

export type PlanLimitFrequency = "daily" | "monthly";

export interface OnlineOrdersQuota {
  max: number;
  frequency: PlanLimitFrequency;
}

export interface ParsedPlanQuotas {
  staffRiderMax: number | null;
  staffAdminMax: number | null;
  aiToolsMonthlyMax: number | null;
  customersMax: number | null;
  transactionsDailyMax: number | null;
  /** Portal PLACE_ORDER + REQUEST_COLLECTION cap; null = unlimited (`full` in Firestore). */
  onlineOrders: OnlineOrdersQuota | null;
  /** Messenger / WhatsApp / SMS / webhook monthly caps (BL-31). */
  channelUsage: ChannelUsageQuotas | null;
}

export type PlanSupportLevel = "none" | "community" | "chat";

export interface PlanSupportAccess {
  level: PlanSupportLevel;
  /** Brevo Conversations live chat (Grow+ when not explicitly limited). */
  chatEnabled: boolean;
}

function finiteNonNegative(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function isUnlimitedMarker(v: unknown): boolean {
  return v === "full" || v === "unlimited";
}

/**
 * @param {unknown} limitations Raw `limitations` map from a subscription plan doc.
 * @return {ParsedPlanQuotas | null} Null when input is empty or not an object.
 */
export function parsePlanLimitations(
  limitations: unknown,
): ParsedPlanQuotas | null {
  if (!limitations || typeof limitations !== "object") return null;
  const L = limitations as Record<string, unknown>;

  let customersMax: number | null = null;
  const cust = L.customers ?? (L as { cutomers?: unknown }).cutomers;
  if (isUnlimitedMarker(cust)) {
    customersMax = null;
  } else if (cust && typeof cust === "object" && "max" in (cust as object)) {
    customersMax = finiteNonNegative((cust as { max: unknown }).max);
  } else {
    customersMax = finiteNonNegative(cust);
  }

  let aiToolsMonthlyMax: number | null = null;
  const ai = L.aiTools;
  if (isUnlimitedMarker(ai)) {
    aiToolsMonthlyMax = null;
  } else if (ai && typeof ai === "object" && "max" in (ai as object)) {
    aiToolsMonthlyMax = finiteNonNegative((ai as { max: unknown }).max);
  }

  let transactionsDailyMax: number | null = null;
  const tx = L.transactions;
  if (isUnlimitedMarker(tx)) {
    transactionsDailyMax = null;
  } else if (tx && typeof tx === "object") {
    const t = tx as { max?: unknown; frequency?: unknown };
    const freq = String(t.frequency || "").toLowerCase();
    if (!freq || freq === "daily") {
      transactionsDailyMax = finiteNonNegative(t.max);
    }
  }

  const staff = L.staff;
  let staffRiderMax: number | null = null;
  let staffAdminMax: number | null = null;
  if (staff && typeof staff === "object") {
    const s = staff as { rider?: unknown; admin?: unknown };
    staffRiderMax = finiteNonNegative(s.rider);
    staffAdminMax = finiteNonNegative(s.admin);
  }

  let onlineOrders: OnlineOrdersQuota | null = null;
  const oo = L.online_orders ?? L.onlineOrders;
  if (isUnlimitedMarker(oo)) {
    onlineOrders = null;
  } else if (oo && typeof oo === "object") {
    const o = oo as { max?: unknown; frequency?: unknown };
    const max = finiteNonNegative(o.max);
    const freq = String(o.frequency || "daily").toLowerCase();
    if (max !== null && max > 0) {
      onlineOrders = {
        max,
        frequency: freq === "monthly" ? "monthly" : "daily",
      };
    }
  }

  return {
    staffRiderMax,
    staffAdminMax,
    aiToolsMonthlyMax,
    customersMax,
    transactionsDailyMax,
    onlineOrders,
    channelUsage: parseChannelUsageQuotas(L.channels),
  };
}

function quotaIsCapped(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * @param {ParsedPlanQuotas | null} q Parsed quotas.
 * @return {boolean} True when at least one quota dimension is a finite cap.
 */
export function hasCappedQuotas(q: ParsedPlanQuotas | null): boolean {
  if (!q) return false;
  return (
    quotaIsCapped(q.staffRiderMax) ||
    quotaIsCapped(q.staffAdminMax) ||
    quotaIsCapped(q.aiToolsMonthlyMax) ||
    quotaIsCapped(q.customersMax) ||
    quotaIsCapped(q.transactionsDailyMax) ||
    q.onlineOrders !== null
  );
}

/**
 * @param {string | undefined} extension Add-on `extendsPlanLimitation` value.
 * @param {ParsedPlanQuotas} q Parsed quotas for the target plan.
 * @return {boolean} Whether the add-on applies to this plan's limits.
 */
export function addonExtensionMatchesPlan(
  extension: string | undefined,
  q: ParsedPlanQuotas,
): boolean {
  const ext = String(extension || "none")
    .toLowerCase()
    .replace(/-/g, "_");
  if (!ext || ext === "none") return true;

  switch (ext) {
  case "staff_rider":
    return quotaIsCapped(q.staffRiderMax);
  case "staff_admin":
    return quotaIsCapped(q.staffAdminMax);
  case "ai_tools":
    return quotaIsCapped(q.aiToolsMonthlyMax);
  case "customers":
    return quotaIsCapped(q.customersMax);
  case "transactions_daily":
    return quotaIsCapped(q.transactionsDailyMax);
  case "online_orders":
    return q.onlineOrders !== null;
  case "extra_business":
    return true;
  default:
    return true;
  }
}

/**
 * @param {Record<string, unknown>} row Plan document data (includes code, name).
 * @param {string} planCode Requested plan code (e.g. pro, scale).
 * @return {boolean} Whether this plan row matches the requested checkout tier.
 */
/**
 * Resolves live-chat / support tier from `subscription_plans.limitations.support`.
 * Falls back to plan code when the field is absent (Grow+ → chat, Starter → community only).
 * @param {unknown} limitations Plan limitations map.
 * @param {string} planCode Active plan code.
 * @return {PlanSupportAccess} Support access flags for the dashboard.
 */
export function parsePlanSupportAccess(
  limitations: unknown,
  planCode: string,
): PlanSupportAccess {
  const code = (planCode || "starter").toLowerCase();

  if (limitations && typeof limitations === "object") {
    const L = limitations as Record<string, unknown>;
    const support = L.support;

    if (support === false || support === "none" || support === 0) {
      return { level: "none", chatEnabled: false };
    }

    if (support === "community") {
      return { level: "community", chatEnabled: false };
    }

    if (
      support === true ||
      support === "chat" ||
      support === "email" ||
      support === "priority" ||
      support === "dedicated" ||
      support === "full"
    ) {
      return { level: "chat", chatEnabled: true };
    }

    if (typeof support === "object" && support !== null) {
      const s = support as Record<string, unknown>;

      if (s.agentChat === true || s.agentChat === "full") {
        return { level: "chat", chatEnabled: true };
      }
      if (s.agentChat === false) {
        return { level: "community", chatEnabled: false };
      }

      const chatVal = s.chat;
      if (chatVal && typeof chatVal === "object") {
        return { level: "community", chatEnabled: false };
      }

      const chatFlag = chatVal ?? s.liveChat ?? s.conversations;
      if (chatFlag === false) {
        return { level: "community", chatEnabled: false };
      }
      if (chatFlag === true) {
        return { level: "chat", chatEnabled: true };
      }
      if (s.enabled === false) {
        return { level: "none", chatEnabled: false };
      }
      if (s.enabled === true) {
        return { level: "chat", chatEnabled: true };
      }
    }
  }

  if (code === "starter" || code === "free") {
    return { level: "community", chatEnabled: false };
  }
  if (
    code === "pro" ||
    code === "grow" ||
    code === "scale" ||
    code === "enterprise"
  ) {
    return { level: "chat", chatEnabled: true };
  }
  return { level: "none", chatEnabled: false };
}

const LIVE_CHAT_ACTIVE_STATUSES = new Set(["active", "grace_period"]);

/**
 * Applies subscription state on top of plan catalog support flags.
 * Grow / Scale / Enterprise (including Scale free trial) get Brevo live chat when
 * the plan catalog enables it. Starter never does.
 * @param {object} input Plan support + active subscription row fields.
 * @return {PlanSupportAccess} Effective support access for the dashboard and APIs.
 */
export function resolveEffectiveSupportAccess(input: {
  planSupport: PlanSupportAccess;
  planCode: string;
  billingCycle: string;
  status: string;
  isExpired: boolean;
}): PlanSupportAccess {
  const code = (input.planCode || "starter").toLowerCase();
  const cycle = (input.billingCycle || "").toLowerCase();
  const status = (input.status || "").toLowerCase();
  const isTrial = cycle === "trial" || status === "trial";
  const isStarter = code === "starter" || code === "free";
  const subscriptionActive =
    LIVE_CHAT_ACTIVE_STATUSES.has(status) || status === "trial";

  const chatEnabled =
    input.planSupport.chatEnabled &&
    subscriptionActive &&
    !isStarter &&
    !input.isExpired;

  let level = input.planSupport.level;
  if (!chatEnabled) {
    if (isStarter || isTrial) {
      level = "community";
    } else if (level === "chat") {
      level = "community";
    }
  }

  return { level, chatEnabled };
}

export function subscriptionPlanRowMatchesCode(
  row: Record<string, unknown>,
  planCode: string,
): boolean {
  const pc = planCode.toLowerCase();
  const code = String(row.code || "").toLowerCase();
  const name = String(row.name || "").toLowerCase();

  if (code === pc || name === pc) return true;

  const growAliases = ["pro", "grow"];
  if (
    growAliases.includes(pc) &&
    (growAliases.includes(code) || name === "grow")
  ) {
    return true;
  }

  return false;
}
