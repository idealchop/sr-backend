import { geminiGenerateJson } from "./gemini-client";
import { getGeminiApiKey } from "./gemini-config";
import type { DuplicateGroup } from "./duplicate-customers-service";

export type DuplicateGroupAiValidation = {
  isLikelyDuplicate: boolean;
  confidencePercent: number;
  summary: string;
  recommendedPrimaryId?: string;
};

type AiGroupAssessment = {
  groupIndex: number;
  isLikelyDuplicate: boolean;
  confidencePercent: number;
  summary: string;
  recommendedPrimaryId?: string;
};

type AiValidationBatchResponse = {
  groups: AiGroupAssessment[];
};

const MAX_GROUPS_PER_BATCH = 12;
const REJECT_CONFIDENCE_THRESHOLD = 55;

function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeAssessment(
  raw: Partial<AiGroupAssessment> | undefined,
  group: DuplicateGroup,
): DuplicateGroupAiValidation {
  const recommendedPrimaryId =
    typeof raw?.recommendedPrimaryId === "string" &&
    group.customers.some((c) => c.id === raw.recommendedPrimaryId) ?
      raw.recommendedPrimaryId :
      group.customers[0]?.id;

  return {
    isLikelyDuplicate: raw?.isLikelyDuplicate !== false,
    confidencePercent: clampPercent(raw?.confidencePercent, 70),
    summary:
      typeof raw?.summary === "string" && raw.summary.trim() ?
        raw.summary.trim() :
        group.reason,
    recommendedPrimaryId,
  };
}

function shouldIncludeValidatedGroup(validation: DuplicateGroupAiValidation): boolean {
  if (validation.isLikelyDuplicate) return true;
  return validation.confidencePercent < REJECT_CONFIDENCE_THRESHOLD;
}

function buildFallbackAssessments(groups: DuplicateGroup[]): AiValidationBatchResponse {
  return {
    groups: groups.map((group, groupIndex) => ({
      groupIndex,
      isLikelyDuplicate: true,
      confidencePercent: 65,
      summary:
        "AI validation unavailable; showing heuristic matches only.",
      recommendedPrimaryId: group.customers[0]?.id,
    })),
  };
}

async function validateDuplicateBatch(
  groups: DuplicateGroup[],
  batchOffset: number,
): Promise<Map<number, DuplicateGroupAiValidation>> {
  const payload = groups.map((group, index) => ({
    groupIndex: batchOffset + index,
    heuristicSignals: group.reason,
    customers: group.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      hasMapPin:
        typeof customer.latitude === "number" &&
        typeof customer.longitude === "number",
    })),
  }));

  const fallback = buildFallbackAssessments(groups);
  const raw = await geminiGenerateJson<AiValidationBatchResponse>({
    system:
      "You validate possible duplicate customer (suki) profiles for a Philippines water refilling business. " +
      "Each group was flagged by heuristics (phone, email, address, map pin, fuzzy name). " +
      "Decide if profiles are likely the same household or business vs false positives " +
      "(common names, generic addresses, relatives sharing a phone, typo-only name overlap). " +
      "Return JSON: { groups: [{ groupIndex, isLikelyDuplicate, confidencePercent 0-100, " +
      "summary (one short sentence for the owner), recommendedPrimaryId (best profile to keep) }] }. " +
      "Be conservative: reject only when reasonably confident they are different people.",
    user: JSON.stringify({ candidateGroups: payload }),
    fallback,
    maxOutputTokens: 2048,
    temperature: 0.2,
  });

  const assessments = new Map<number, DuplicateGroupAiValidation>();
  const rawGroups = Array.isArray(raw?.groups) ? raw.groups : fallback.groups;

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const groupIndex = batchOffset + index;
    const match =
      rawGroups.find((item) => Number(item?.groupIndex) === groupIndex) ??
      fallback.groups[index];
    assessments.set(
      groupIndex,
      normalizeAssessment(match, group),
    );
  }

  return assessments;
}

/**
 * Enriches heuristic duplicate groups with Gemini validation and drops confident false positives.
 */
export async function validateDuplicateCustomerGroupsWithAi(
  groups: DuplicateGroup[],
): Promise<DuplicateGroup[]> {
  if (groups.length === 0) return [];
  if (!getGeminiApiKey()) {
    return groups;
  }

  const assessments = new Map<number, DuplicateGroupAiValidation>();

  for (let offset = 0; offset < groups.length; offset += MAX_GROUPS_PER_BATCH) {
    const batch = groups.slice(offset, offset + MAX_GROUPS_PER_BATCH);
    const batchAssessments = await validateDuplicateBatch(batch, offset);
    for (const [groupIndex, validation] of batchAssessments) {
      assessments.set(groupIndex, validation);
    }
  }

  const enriched: DuplicateGroup[] = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const aiValidation =
      assessments.get(index) ??
      normalizeAssessment(undefined, group);

    if (!shouldIncludeValidatedGroup(aiValidation)) {
      continue;
    }

    enriched.push({
      ...group,
      aiValidation,
    });
  }

  return enriched.sort((a, b) => b.customers.length - a.customers.length);
}
