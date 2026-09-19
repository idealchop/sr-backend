import { FieldValue, Timestamp } from "../../config/firebase-admin";
import type { DocumentReference } from "firebase-admin/firestore";
import { logAuditEvent } from "../observability/logging/logger";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { TrialLifecycleService } from "../subscriptions/trial-lifecycle-service";
import { applyTrialOverlayToLimitations } from "../subscriptions/trial-policy";
import { loadEffectiveTrialPolicy } from "../subscriptions/trial-policy-service";
import { planSnapshotFields } from "../subscriptions/plan-snapshot";

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function isTrialRow(data: Record<string, unknown> | undefined): boolean {
  return String(data?.billingCycle || "") === "trial";
}

/**
 * First workspace onboarding: published trial policy (default 15-day Scale).
 */
export async function ensureScaleTrialSubscription(
  businessRef: DocumentReference,
): Promise<void> {
  const policy = await loadEffectiveTrialPolicy();
  if (!policy.enabled) return;

  const subsSnap = await businessRef
    .collection("subscriptions")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  const activatedAt = new Date();
  const expiresAt = addDays(activatedAt, policy.durationDays);
  const gracePeriodExpiresAt = new Date(expiresAt);

  const basePlan = await SubscriptionService.lookupPlanRowForCode(
    policy.basedOnPlanCode,
  );
  let planId = policy.basedOnPlanCode;
  let planName = "Scale Plan";
  let planData: Record<string, unknown> = {
    code: policy.basedOnPlanCode,
    name: planName,
    limitations: {},
  };

  if (basePlan) {
    const p = basePlan.planData as {
      name?: string;
      limitations?: unknown;
      capabilities?: unknown;
      code?: string;
    };
    planId = basePlan.planId;
    planName = p.name || planName;
    planData = {
      ...basePlan.planData,
      code: p.code || policy.basedOnPlanCode,
      name: planName,
      limitations: applyTrialOverlayToLimitations(
        p.limitations,
        policy.overlayLimitations,
      ),
    };
  }

  const snapshot = planSnapshotFields(planData, activatedAt);

  const subPayload = TrialLifecycleService.withTrialBudgetMetadata(expiresAt, {
    planId,
    planCode: policy.basedOnPlanCode,
    planName,
    status: "active",
    billingCycle: "trial",
    price: 0,
    dates: {
      activatedAt: Timestamp.fromDate(activatedAt),
      expiresAt: Timestamp.fromDate(expiresAt),
      renewalAt: Timestamp.fromDate(expiresAt),
      gracePeriodExpiresAt: Timestamp.fromDate(gracePeriodExpiresAt),
    },
    ...snapshot,
    trialTeamChatPreviewDays: policy.teamChatPreviewDays,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (subsSnap.empty) {
    const subRef = businessRef.collection("subscriptions").doc();
    await subRef.set({
      ...subPayload,
      createdAt: FieldValue.serverTimestamp(),
    });
    logAuditEvent("TRIAL_STARTED", {
      businessId: businessRef.id,
      subscriptionId: subRef.id,
    });
    return;
  }

  const subDoc = subsSnap.docs[0];
  const data = subDoc.data();
  const hasValidExpiry =
    data?.dates?.expiresAt != null &&
    String(data?.dates?.expiresAt) !== "";
  const alreadyTrial = isTrialRow(data);

  if (alreadyTrial && hasValidExpiry) {
    return;
  }

  const usedTrial = await TrialLifecycleService.hasUsedTrialBudget(
    businessRef.id,
  );
  if (usedTrial && !alreadyTrial) {
    return;
  }

  if (!hasValidExpiry || !alreadyTrial) {
    await subDoc.ref.set(subPayload, { merge: true });
    if (!alreadyTrial) {
      logAuditEvent("TRIAL_STARTED", {
        businessId: businessRef.id,
        subscriptionId: subDoc.id,
      });
    }
  }
}
