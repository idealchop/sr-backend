/** Intel tool ids — kept in sync with `AI_TOOL_IDS` in ai-tool-run-service. */
export const INTEL_TOOL_IDS = [
  "morning_brief",
  "retention_pulse",
  "collections_pulse",
  "dispatch_health",
  "warehouse_risk",
  "plant_health",
  "dashboard_qa",
  "churn_risk",
] as const;

export type IntelToolId = (typeof INTEL_TOOL_IDS)[number];

export const USAGE_GOAL_IDS = [
  "sales",
  "inventory",
  "customers",
  "delivery",
  "expenses",
  "analytics",
] as const;

export type UsageGoalId = (typeof USAGE_GOAL_IDS)[number];

const USAGE_GOAL_SET = new Set<string>(USAGE_GOAL_IDS);

export const USAGE_GOAL_META: Record<
  UsageGoalId,
  { label: string; description: string }
> = {
  sales: {
    label: "Sales tracking",
    description: "Monitor daily refills, collections, and revenue in one place.",
  },
  inventory: {
    label: "Inventory control",
    description: "Track bottles, caps, stickers, and stock levels accurately.",
  },
  customers: {
    label: "Customer management",
    description: "Manage suki accounts, balances, and delivery schedules.",
  },
  delivery: {
    label: "Delivery operations",
    description: "Assign riders, routes, and delivery status updates.",
  },
  expenses: {
    label: "Expense logging",
    description: "Record utilities, payroll, and operating costs.",
  },
  analytics: {
    label: "Business insights",
    description: "Review trends, margins, and station performance over time.",
  },
};

/** Intel tools most aligned with each onboarding goal id. */
export const USAGE_GOAL_INTEL_TOOLS: Record<
  UsageGoalId,
  readonly IntelToolId[]
> = {
  sales: ["morning_brief", "collections_pulse"],
  inventory: ["warehouse_risk", "morning_brief"],
  customers: ["retention_pulse", "collections_pulse"],
  delivery: ["dispatch_health", "morning_brief"],
  expenses: ["morning_brief"],
  analytics: ["retention_pulse", "morning_brief", "dispatch_health", "collections_pulse"],
};

export type OwnerUsageGoalsContext = {
  ids: UsageGoalId[];
  labels: string[];
  descriptions: string[];
  recommendedIntelTools: IntelToolId[];
};

/**
 * Normalizes `businesses.usageGoals` from onboarding / configuration.
 * @param {unknown} raw Firestore field value.
 * @return {UsageGoalId[]} Known goal ids in stable order.
 */
export function normalizeUsageGoalIds(raw: unknown): UsageGoalId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<UsageGoalId>();
  const out: UsageGoalId[] = [];
  for (const item of raw) {
    const id = String(item || "").trim().toLowerCase();
    if (!USAGE_GOAL_SET.has(id)) continue;
    const goal = id as UsageGoalId;
    if (seen.has(goal)) continue;
    seen.add(goal);
    out.push(goal);
  }
  return out;
}

/**
 * @param {unknown} raw Firestore `usageGoals` array.
 * @return {OwnerUsageGoalsContext} Labels + recommended tools for River AI.
 */
export function buildOwnerUsageGoalsContext(
  raw: unknown,
): OwnerUsageGoalsContext {
  const ids = normalizeUsageGoalIds(raw);
  const labels = ids.map((id) => USAGE_GOAL_META[id].label);
  const descriptions = ids.map((id) => USAGE_GOAL_META[id].description);

  const toolScores = new Map<IntelToolId, number>();
  for (const goalId of ids) {
    for (const tool of USAGE_GOAL_INTEL_TOOLS[goalId]) {
      toolScores.set(tool, (toolScores.get(tool) || 0) + 1);
    }
  }

  const toolRank = new Map(INTEL_TOOL_IDS.map((id, i) => [id, i]));
  const recommendedIntelTools = [...toolScores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return (toolRank.get(a[0]) ?? 99) - (toolRank.get(b[0]) ?? 99);
    })
    .map(([tool]) => tool);

  return {
    ids,
    labels,
    descriptions,
    recommendedIntelTools,
  };
}

/**
 * @param {AiToolId} tool Active intel tool.
 * @param {OwnerUsageGoalsContext} goals Owner priorities from Firestore.
 * @return {boolean} Whether this tool is recommended for the owner's goals.
 */
export function isIntelToolRecommendedForGoals(
  tool: IntelToolId,
  goals: OwnerUsageGoalsContext,
): boolean {
  return goals.recommendedIntelTools.includes(tool);
}
