export type SupportAiChatFrequency = "daily" | "monthly";

export interface SupportAiPlanLimits {
  chatMax: number | null;
  chatFrequency: SupportAiChatFrequency | null;
  attachmentsMax: number | null;
  attachmentsAllowed: boolean;
  agentChatEnabled: boolean;
}

export interface SupportAiUsageSnapshot extends SupportAiPlanLimits {
  chatUsed: number;
  attachmentsUsed: number;
}

function finiteNonNegative(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function isUnlimitedMarker(v: unknown): boolean {
  return v === "full" || v === "unlimited";
}

function parseSupportAiChatQuota(value: unknown): {
  chatMax: number | null;
  chatFrequency: SupportAiChatFrequency | null;
} | null {
  if (isUnlimitedMarker(value)) {
    return { chatMax: null, chatFrequency: null };
  }
  if (value && typeof value === "object" && "max" in (value as object)) {
    const row = value as { max?: unknown; frequency?: unknown };
    const max = finiteNonNegative(row.max);
    const freq = String(row.frequency || "monthly").toLowerCase();
    return {
      chatMax: max,
      chatFrequency: freq === "daily" ? "daily" : "monthly",
    };
  }
  return null;
}

function parseSupportAiAttachments(value: unknown): {
  attachmentsAllowed: boolean;
  attachmentsMax: number | null;
} | null {
  if (value === false || value === "none" || value === 0) {
    return { attachmentsAllowed: false, attachmentsMax: null };
  }
  if (value === true || isUnlimitedMarker(value)) {
    return { attachmentsAllowed: true, attachmentsMax: null };
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row.enabled === false) {
      return { attachmentsAllowed: false, attachmentsMax: null };
    }
    const max = isUnlimitedMarker(row.max) ?
      null :
      finiteNonNegative(row.max);
    return {
      attachmentsAllowed: row.enabled !== false,
      attachmentsMax: max,
    };
  }
  return null;
}

/**
 * Reads River AI support quotas from `subscription_plans.limitations.support`
 * (Scale trial uses `support.trial` when billing cycle is trial).
 * @param {unknown} limitations Plan limitations map from Firestore.
 * @param {object} context Active plan code and billing cycle.
 * @return {Partial<SupportAiPlanLimits> | null} Parsed overrides, if any.
 */
export function parsePlanSupportAiLimits(
  limitations: unknown,
  context: {
    planCode: string;
    billingCycle: string;
    status: string;
  },
): Partial<SupportAiPlanLimits> | null {
  if (!limitations || typeof limitations !== "object") return null;
  const L = limitations as Record<string, unknown>;
  const cycle = (context.billingCycle || "").toLowerCase();
  const status = (context.status || "").toLowerCase();
  const isTrial = cycle === "trial" || status === "trial";
  const isScale = (context.planCode || "starter").toLowerCase() === "scale";

  const support = L.support;
  if (!support || typeof support !== "object") return null;

  let row = support as Record<string, unknown>;
  if (isTrial && isScale && row.trial && typeof row.trial === "object") {
    row = row.trial as Record<string, unknown>;
  }

  const parsed: Partial<SupportAiPlanLimits> = {};

  const chat = parseSupportAiChatQuota(row.chat);
  if (chat) {
    parsed.chatMax = chat.chatMax;
    parsed.chatFrequency = chat.chatFrequency;
  }

  const attachments = parseSupportAiAttachments(row.attachments);
  if (attachments) {
    parsed.attachmentsAllowed = attachments.attachmentsAllowed;
    parsed.attachmentsMax = attachments.attachmentsMax;
  }

  if (row.agentChat === true || row.agentChat === "full") {
    parsed.agentChatEnabled = true;
  } else if (row.agentChat === false) {
    parsed.agentChatEnabled = false;
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

function resolveSupportAiPlanLimitsByTier(input: {
  planCode: string;
  billingCycle: string;
  status: string;
  isExpired: boolean;
  agentChatEnabled: boolean;
}): SupportAiPlanLimits {
  const code = (input.planCode || "starter").toLowerCase();
  const cycle = (input.billingCycle || "").toLowerCase();
  const status = (input.status || "").toLowerCase();
  const isTrial = cycle === "trial" || status === "trial";
  const isStarter = code === "starter" || code === "free";
  const isGrow = code === "grow" || code === "pro";
  const isScale = code === "scale";
  const isEnterprise = code === "enterprise";

  if (input.isExpired) {
    return {
      chatMax: 0,
      chatFrequency: "monthly",
      attachmentsMax: 0,
      attachmentsAllowed: false,
      agentChatEnabled: false,
    };
  }

  if (isTrial && isScale) {
    return {
      chatMax: 50,
      chatFrequency: "daily",
      attachmentsMax: 50,
      attachmentsAllowed: true,
      agentChatEnabled: input.agentChatEnabled,
    };
  }

  if (isStarter) {
    return {
      chatMax: 5,
      chatFrequency: "monthly",
      attachmentsMax: null,
      attachmentsAllowed: false,
      agentChatEnabled: false,
    };
  }

  if (isGrow) {
    return {
      chatMax: 10,
      chatFrequency: "monthly",
      attachmentsMax: null,
      attachmentsAllowed: true,
      agentChatEnabled: input.agentChatEnabled,
    };
  }

  if (isScale || isEnterprise) {
    return {
      chatMax: null,
      chatFrequency: null,
      attachmentsMax: null,
      attachmentsAllowed: true,
      agentChatEnabled: input.agentChatEnabled,
    };
  }

  return {
    chatMax: 5,
    chatFrequency: "monthly",
    attachmentsMax: null,
    attachmentsAllowed: false,
    agentChatEnabled: false,
  };
}

export function supportAiPlanLimitsFromSnapshot(
  snapshot: SupportAiUsageSnapshot,
): SupportAiPlanLimits {
  return {
    chatMax: snapshot.chatMax,
    chatFrequency: snapshot.chatFrequency,
    attachmentsMax: snapshot.attachmentsMax,
    attachmentsAllowed: snapshot.attachmentsAllowed,
    agentChatEnabled: snapshot.agentChatEnabled,
  };
}

/**
 * River AI support chat quotas by subscription tier.
 * Firestore `limitations.support` (and `support.trial` on Scale) override code defaults.
 * @param {object} input Active plan code, billing cycle, and agent-chat flag.
 * @return {SupportAiPlanLimits} Resolved limits for enforcement and UI.
 */
export function resolveSupportAiPlanLimits(input: {
  planCode: string;
  billingCycle: string;
  status: string;
  isExpired: boolean;
  agentChatEnabled: boolean;
  limitations?: unknown;
}): SupportAiPlanLimits {
  const base = resolveSupportAiPlanLimitsByTier(input);
  const fromPlan = parsePlanSupportAiLimits(input.limitations, input);
  if (!fromPlan) return base;

  const agentFromPlan = fromPlan.agentChatEnabled;
  const agentChatEnabled =
    agentFromPlan === undefined ?
      base.agentChatEnabled :
      agentFromPlan && input.agentChatEnabled;

  return {
    chatMax: fromPlan.chatMax !== undefined ? fromPlan.chatMax : base.chatMax,
    chatFrequency:
      fromPlan.chatFrequency !== undefined ?
        fromPlan.chatFrequency :
        base.chatFrequency,
    attachmentsMax:
      fromPlan.attachmentsMax !== undefined ?
        fromPlan.attachmentsMax :
        base.attachmentsMax,
    attachmentsAllowed:
      fromPlan.attachmentsAllowed !== undefined ?
        fromPlan.attachmentsAllowed :
        base.attachmentsAllowed,
    agentChatEnabled,
  };
}
