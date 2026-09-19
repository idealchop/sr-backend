import { isFreePlan } from "../../utils/subscription-plan-codes";
import {
  isCatalogLiveForNewSales,
  parseCatalogDate,
} from "../../utils/catalog-publication";
import {
  parsePlanCapabilities,
  type PlanCapabilities,
} from "../../utils/plan-capabilities";

export type PlanCatalogSnapshot = {
  planLimitationsSnapshot: Record<string, unknown>;
  planCapabilitiesSnapshot: PlanCapabilities;
  catalogPublishedAt: string | null;
  catalogEffectiveAt: string | null;
};

function asLimitationsMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function mergeLimitationPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === "object" &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeLimitationPatch(
        next[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function buildPlanCatalogSnapshot(
  planData: Record<string, unknown> | null | undefined,
  now = new Date(),
): PlanCatalogSnapshot {
  const data = planData || {};
  const publishedAt = parseCatalogDate(data.publishedAt);
  const effectiveAt = parseCatalogDate(data.effectiveAt);
  return {
    planLimitationsSnapshot: asLimitationsMap(data.limitations),
    planCapabilitiesSnapshot: parsePlanCapabilities(
      data.capabilities,
      String(data.code || ""),
    ),
    catalogPublishedAt: publishedAt ? publishedAt.toISOString() : now.toISOString(),
    catalogEffectiveAt: effectiveAt ? effectiveAt.toISOString() : now.toISOString(),
  };
}

export function planSnapshotFields(
  planData: Record<string, unknown> | null | undefined,
  now = new Date(),
): PlanCatalogSnapshot {
  return buildPlanCatalogSnapshot(planData, now);
}

export function limitationsFromRowOrPlan(
  sub: Record<string, unknown>,
  livePlan: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  const snapshot = sub.planLimitationsSnapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    return snapshot as Record<string, unknown>;
  }
  if (livePlan?.limitations && typeof livePlan.limitations === "object") {
    return livePlan.limitations as Record<string, unknown>;
  }
  return undefined;
}

export function capabilitiesFromRowOrPlan(
  sub: Record<string, unknown>,
  livePlan: Record<string, unknown> | null | undefined,
): PlanCapabilities {
  if (sub.planCapabilitiesSnapshot) {
    return parsePlanCapabilities(
      sub.planCapabilitiesSnapshot,
      String(sub.planCode || livePlan?.code || ""),
    );
  }
  return parsePlanCapabilities(
    livePlan?.capabilities,
    String(sub.planCode || livePlan?.code || ""),
  );
}

/**
 * Free stations pick up a newly published catalog version at `effectiveAt`.
 * Paid and trial rows keep the snapshot stamped at period start.
 */
export function shouldRefreshFreeCatalogSnapshot(
  sub: Record<string, unknown>,
  livePlan: Record<string, unknown> | null | undefined,
  now = new Date(),
): boolean {
  if (!livePlan || !isCatalogLiveForNewSales(livePlan, now)) return false;
  if (String(sub.billingCycle || "").toLowerCase() === "trial") return false;
  if (!isFreePlan(String(sub.planCode || ""))) return false;
  const liveEffective = parseCatalogDate(livePlan.effectiveAt);
  if (!liveEffective) return false;
  if (liveEffective.getTime() > now.getTime()) return false;
  const snapEffective = parseCatalogDate(sub.catalogEffectiveAt);
  if (!snapEffective) return true;
  return liveEffective.getTime() > snapEffective.getTime();
}

export function needsInitialCatalogSnapshot(sub: Record<string, unknown>): boolean {
  return !(
    sub.planLimitationsSnapshot &&
    typeof sub.planLimitationsSnapshot === "object" &&
    !Array.isArray(sub.planLimitationsSnapshot)
  );
}
