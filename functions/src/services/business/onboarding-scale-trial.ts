import { FieldValue, Timestamp } from "../../config/firebase-admin";
import type { DocumentReference } from "firebase-admin/firestore";
import { logAuditEvent } from "../observability/logging/logger";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { TrialLifecycleService } from "../subscriptions/trial-lifecycle-service";

const TRIAL_DAYS = 7;

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * First workspace onboarding: Scale plan, 7-day trial (`billingCycle: trial`).
 * Uses `dates.expiresAt` (not `trialExpiresAt`) so subscription status UI counts days correctly.
 * @param {DocumentReference} businessRef The document reference to the business
 */
export async function ensureScaleTrialSubscription(
  businessRef: DocumentReference,
): Promise<void> {
  const subsSnap = await businessRef
    .collection("subscriptions")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  const activatedAt = new Date();
  const expiresAt = addDays(activatedAt, TRIAL_DAYS);
  const gracePeriodExpiresAt = new Date(expiresAt);

  const scalePlan = await SubscriptionService.lookupPlanRowForCode("scale");
  let planId = "scale";
  let planName = "Scale Plan";

  if (scalePlan) {
    const p = scalePlan.planData as {
      name?: string;
      pricing?: { monthly?: number };
    };
    planId = scalePlan.planId;
    planName = p.name || planName;
  }

  const subPayload = TrialLifecycleService.withTrialBudgetMetadata(expiresAt, {
    planId,
    planCode: "scale",
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
  const isScaleTrial =
    String(data?.planCode || "").toLowerCase() === "scale" &&
    String(data?.billingCycle || "") === "trial";

  if (isScaleTrial && hasValidExpiry) {
    return;
  }

  const usedTrial = await TrialLifecycleService.hasUsedTrialBudget(
    businessRef.id,
  );
  if (usedTrial && !isScaleTrial) {
    return;
  }

  if (!hasValidExpiry || !isScaleTrial) {
    await subDoc.ref.set(subPayload, { merge: true });
    if (!isScaleTrial) {
      logAuditEvent("TRIAL_STARTED", {
        businessId: businessRef.id,
        subscriptionId: subDoc.id,
      });
    }
  }
}
