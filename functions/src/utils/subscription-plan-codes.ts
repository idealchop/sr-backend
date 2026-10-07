/**
 * Canonical plan-code helpers. Free (₱0 forever) and Starter (paid) are distinct.
 * Legacy unpaid `starter` rows are migrated to `free` at status read.
 */

export function normalizePlanCode(planCode: string | undefined | null): string {
  return String(planCode || "").toLowerCase().trim();
}

export function isFreePlan(planCode: string | undefined | null): boolean {
  return normalizePlanCode(planCode) === "free";
}

export function isStarterPlan(planCode: string | undefined | null): boolean {
  return normalizePlanCode(planCode) === "starter";
}

/** Owner-only workspace: no Team Hub / rider / admin seats. */
export function isOwnerOnlyPlan(planCode: string | undefined | null): boolean {
  const code = normalizePlanCode(planCode);
  return code === "free" || code === "starter";
}

export function isGrowPlan(planCode: string | undefined | null): boolean {
  const code = normalizePlanCode(planCode);
  return code === "grow" || code === "pro";
}

export function isScalePlanFamily(planCode: string | undefined | null): boolean {
  const code = normalizePlanCode(planCode);
  return code === "scale" || code === "enterprise";
}

/** Visit-pattern Forecast list — Grow, Scale, and Enterprise. */
export function planAllowsForecast(planCode: string | undefined | null): boolean {
  return isGrowPlan(planCode) || isScalePlanFamily(planCode);
}

/** Gemini duplicate review — Scale / Enterprise only. Free through Grow use detailed comparison. */
export function planAllowsDuplicateAiValidation(
  planCode: string | undefined | null,
): boolean {
  return isScalePlanFamily(planCode);
}

/** On-demand AI Forecast (habit override) — Scale / Enterprise only. */
export function planAllowsForecastAi(
  planCode: string | undefined | null,
): boolean {
  return isScalePlanFamily(planCode);
}

/**
 * Unpaid forever Starter from the previous catalog (price ₱0).
 * Paid Starter is ₱399 and must not match.
 */
export function isLegacyUnpaidStarterRow(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  const code = String(data.planCode || "");
  const name = String(data.planName || "").toLowerCase().trim();
  const isStarter =
    isStarterPlan(code) || name === "starter" || name.startsWith("starter ");
  if (!isStarter) return false;
  const price = Number(data.price);
  return !Number.isFinite(price) || price <= 0;
}
