import { mergeLimitationPatch } from "./plan-snapshot";

export const TRIAL_POLICY_COLLECTION = "subscription_trial_policy";
export const TRIAL_POLICY_DOC_ID = "current";

export type TrialPolicy = {
  enabled: boolean;
  durationDays: number;
  basedOnPlanCode: string;
  fallbackPlanCode: string;
  teamChatPreviewDays: number;
  pauseAllowed: boolean;
  oneTrialPerBusiness: boolean;
  overlayLimitations: Record<string, unknown>;
};

export const DEFAULT_TRIAL_POLICY: TrialPolicy = {
  enabled: true,
  durationDays: 15,
  basedOnPlanCode: "scale",
  fallbackPlanCode: "free",
  teamChatPreviewDays: 3,
  pauseAllowed: true,
  oneTrialPerBusiness: true,
  overlayLimitations: {
    support: {
      trial: {
        chat: { max: 5, frequency: "daily" },
        attachments: { enabled: true, max: 5, frequency: "daily" },
        agentChat: true,
      },
    },
  },
};

function finitePositive(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

export function parseTrialPolicy(
  data: Record<string, unknown> | null | undefined,
): TrialPolicy {
  if (!data) return { ...DEFAULT_TRIAL_POLICY };
  const overlay =
    data.overlayLimitations && typeof data.overlayLimitations === "object" ?
      (data.overlayLimitations as Record<string, unknown>) :
      DEFAULT_TRIAL_POLICY.overlayLimitations;
  return {
    enabled: data.enabled !== false,
    durationDays: finitePositive(data.durationDays, DEFAULT_TRIAL_POLICY.durationDays),
    basedOnPlanCode:
      String(data.basedOnPlanCode || DEFAULT_TRIAL_POLICY.basedOnPlanCode)
        .toLowerCase()
        .trim() || DEFAULT_TRIAL_POLICY.basedOnPlanCode,
    fallbackPlanCode:
      String(data.fallbackPlanCode || DEFAULT_TRIAL_POLICY.fallbackPlanCode)
        .toLowerCase()
        .trim() || DEFAULT_TRIAL_POLICY.fallbackPlanCode,
    teamChatPreviewDays: finitePositive(
      data.teamChatPreviewDays,
      DEFAULT_TRIAL_POLICY.teamChatPreviewDays,
    ),
    pauseAllowed: data.pauseAllowed !== false,
    oneTrialPerBusiness: data.oneTrialPerBusiness !== false,
    overlayLimitations: overlay,
  };
}

export function applyTrialOverlayToLimitations(
  baseLimitations: unknown,
  overlayLimitations: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    baseLimitations && typeof baseLimitations === "object" && !Array.isArray(baseLimitations) ?
      (baseLimitations as Record<string, unknown>) :
      {};
  return mergeLimitationPatch(base, overlayLimitations);
}
