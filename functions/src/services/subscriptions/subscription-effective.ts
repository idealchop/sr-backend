import type { DocumentReference } from "firebase-admin/firestore";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export type SubscriptionDocRow = {
  id: string;
  ref: DocumentReference;
  data: Record<string, unknown>;
};

export type SubscriptionDatesView = {
  expiresAt: Date;
  graceExpiresAt: Date;
  activatesAt: Date | null;
  status: string;
  isExpired: boolean;
  isGracePeriod: boolean;
};

export function parseSubscriptionTimestamp(ts: unknown): Date {
  if (!ts) return new Date();
  if (ts instanceof Date) return ts;
  if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (typeof (ts as { seconds?: number }).seconds === "number") {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === "string") return new Date(ts);
  return new Date();
}

export function isPaidBillingCycle(cycle: string): boolean {
  return cycle === "monthly" || cycle === "yearly";
}

export function isStarterPlan(planCode: string): boolean {
  const code = String(planCode || "").toLowerCase();
  return code === "starter" || code === "free";
}

export function isSuperseded(data: Record<string, unknown>): boolean {
  return String(data.status || "") === "superseded";
}

export function getActivatesAt(data: Record<string, unknown>): Date | null {
  const dates = data.dates as { activatesAt?: unknown } | undefined;
  if (!dates?.activatesAt) return null;
  return parseSubscriptionTimestamp(dates.activatesAt);
}

export function paymentReadyForActivation(data: Record<string, unknown>): boolean {
  const ps = String(data.paymentStatus || "");
  if (ps === "failed" || ps === "pending_verification") return false;
  if (ps === "verified" || ps === "approved") return true;
  const price = Number(data.price) || 0;
  return price <= 0;
}

/**
 * Derives display/access status from persisted row + dates (read-model).
 * @param {Record<string, unknown>} data Subscription document fields.
 * @param {Date} now Reference time for expiry/grace checks.
 * @return {SubscriptionDatesView} Computed dates and derived status flags.
 */
export function computeDatesView(
  data: Record<string, unknown>,
  now: Date,
): SubscriptionDatesView {
  const dates = (data.dates || {}) as Record<string, unknown>;
  const expiresAt = parseSubscriptionTimestamp(
    dates.expiresAt ?? dates.trialExpiresAt,
  );
  const graceFromDoc = dates.gracePeriodExpiresAt ?
    parseSubscriptionTimestamp(dates.gracePeriodExpiresAt) :
    null;
  const cycle = String(data.billingCycle || "");
  const activatesAt = getActivatesAt(data);

  let graceExpiresAt = graceFromDoc;
  if (!graceExpiresAt) {
    graceExpiresAt = new Date(expiresAt);
    if (isPaidBillingCycle(cycle)) {
      graceExpiresAt.setDate(graceExpiresAt.getDate() + 7);
    }
  }
  if (cycle === "trial") {
    graceExpiresAt = new Date(expiresAt);
  }

  const persisted = String(data.status || "active");
  let status = persisted;

  if (persisted === "superseded" || persisted === "scheduled") {
    status = persisted;
  } else if (persisted === "expired" || persisted === "grace_period") {
    status = persisted;
  } else if (cycle === "trial") {
    status = now > expiresAt ? "expired" : "active";
  } else if (persisted === "active" || persisted === "approved") {
    if (now > graceExpiresAt) status = "expired";
    else if (now > expiresAt) status = "grace_period";
    else status = "active";
  }

  const isExpired =
    cycle === "trial" ?
      now > expiresAt :
      status === "expired" || now > graceExpiresAt;
  const isGracePeriod =
    cycle === "trial" ? false : status === "grace_period";

  return {
    expiresAt,
    graceExpiresAt,
    activatesAt,
    status,
    isExpired,
    isGracePeriod,
  };
}

export function isEntitlingRow(data: Record<string, unknown>, now: Date): boolean {
  if (isSuperseded(data)) return false;
  const persisted = String(data.status || "");
  if (persisted === "scheduled" || persisted === "approved") return false;
  if (persisted !== "active" && persisted !== "grace_period") return false;

  const view = computeDatesView(data, now);
  if (view.isExpired || view.status === "expired") return false;

  const cycle = String(data.billingCycle || "");
  if (cycle === "trial") {
    const meta = data.metadata as Record<string, unknown> | undefined;
    if (String(meta?.trialState || "running").toLowerCase() === "paused") {
      return false;
    }
    return now <= view.expiresAt;
  }
  if (isPaidBillingCycle(cycle)) {
    if (!paymentReadyForActivation(data)) return false;
    return now <= view.graceExpiresAt;
  }

  const code = String(data.planCode || "").toLowerCase();
  if (isStarterPlan(code)) {
    return persisted === "active";
  }

  return false;
}

export function pickEffectiveEntitling(
  rows: SubscriptionDocRow[],
  now: Date,
): SubscriptionDocRow | null {
  const entitling = rows.filter((r) => isEntitlingRow(r.data, now));
  if (entitling.length === 0) return null;

  entitling.sort((a, b) => {
    const aActive = String(a.data.status || "") === "active" ? 1 : 0;
    const bActive = String(b.data.status || "") === "active" ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;

    const va = computeDatesView(a.data, now);
    const vb = computeDatesView(b.data, now);
    return vb.graceExpiresAt.getTime() - va.graceExpiresAt.getTime();
  });
  return entitling[0];
}

/**
 * Future renewal queued until current paid period ends.
 * @param {SubscriptionDocRow[]} rows Recent subscription documents.
 * @param {Date} now Reference time.
 * @return {SubscriptionDocRow | null} Scheduled row waiting for activation, if any.
 */
export function pickPendingScheduled(
  rows: SubscriptionDocRow[],
  now: Date,
): SubscriptionDocRow | null {
  for (const row of rows) {
    const st = String(row.data.status || "");
    if (st !== "scheduled" && st !== "approved") continue;
    const activatesAt = getActivatesAt(row.data);
    if (activatesAt && activatesAt > now) {
      return row;
    }
  }
  return null;
}

/**
 * Paid upgrade/checkout awaiting ops approval (Starter → Grow/Scale, etc.).
 * Blocks auto-recreation of Starter while payment is in review.
 * @param {SubscriptionDocRow[]} rows Recent subscription documents.
 * @param {Date} now Reference time.
 * @return {SubscriptionDocRow | null} Pending paid upgrade row, if any.
 */
export function pickPendingPaidUpgrade(
  rows: SubscriptionDocRow[],
  now: Date,
): SubscriptionDocRow | null {
  for (const row of rows) {
    if (isSuperseded(row.data)) continue;
    const st = String(row.data.status || "");
    const ps = String(row.data.paymentStatus || "");
    if (ps === "failed") continue;
    if (!isPaidBillingCycle(String(row.data.billingCycle || ""))) continue;
    if (isStarterPlan(String(row.data.planCode || ""))) continue;

    if (st === "pending" && ps === "pending_verification") {
      return row;
    }

    if (
      st === "active" &&
      ps === "pending_verification" &&
      !isStarterPlan(String(row.data.planCode || ""))
    ) {
      return row;
    }

    if (st === "approved" && paymentReadyForActivation(row.data)) {
      const activatesAt = getActivatesAt(row.data);
      if (!activatesAt || activatesAt <= now) {
        return row;
      }
    }
  }
  return null;
}

export async function fetchRecentSubscriptionRows(
  businessId: string,
  limit = 32,
): Promise<SubscriptionDocRow[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("subscriptions")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    ref: d.ref,
    data: d.data() as Record<string, unknown>,
  }));
}

export function calculatePeriodDates(
  startDate: Date,
  cycle: "monthly" | "yearly" | "trial",
): { expiresAt: Date; gracePeriodExpiresAt: Date } {
  const expiresAt = new Date(startDate);
  if (cycle === "monthly") expiresAt.setMonth(expiresAt.getMonth() + 1);
  else if (cycle === "yearly") {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else if (cycle === "trial") {
    expiresAt.setDate(expiresAt.getDate() + 7);
  }

  const gracePeriodExpiresAt = new Date(expiresAt);
  if (isPaidBillingCycle(cycle)) {
    gracePeriodExpiresAt.setDate(gracePeriodExpiresAt.getDate() + 7);
  }

  return { expiresAt, gracePeriodExpiresAt };
}

/**
 * Defer the next subscription row until the current paid period ends.
 * - RENEW / DOWNGRADE: always defer while current paid period is active.
 * - UPGRADE: defer paid → paid (e.g. Grow → Scale); Starter → paid starts immediately.
 * @param {string} action Subscription action (e.g. RENEW).
 * @param {SubscriptionDocRow | null} current Currently entitling row, if any.
 * @param {Date} now Reference time.
 * @return {Date | null} Deferred activation instant, or null when the row should start immediately.
 */
export function shouldDeferRenewalToPeriodEnd(
  action: string,
  current: SubscriptionDocRow | null,
  now: Date,
): Date | null {
  if (!current) return null;
  const cycle = String(current.data.billingCycle || "");
  if (!isPaidBillingCycle(cycle)) return null;
  if (!isEntitlingRow(current.data, now)) return null;
  const view = computeDatesView(current.data, now);
  if (now >= view.expiresAt) return null;

  if (action === "UPGRADE") {
    if (isStarterPlan(String(current.data.planCode || ""))) return null;
    return view.expiresAt;
  }

  if (action !== "RENEW" && action !== "DOWNGRADE") return null;
  return view.expiresAt;
}

export async function supersedeOtherEntitlingRows(
  businessId: string,
  exceptRef: DocumentReference,
  rows: SubscriptionDocRow[],
  now: Date,
): Promise<void> {
  const batch = db.batch();
  let count = 0;
  for (const row of rows) {
    if (row.ref.path === exceptRef.path) continue;
    if (!isEntitlingRow(row.data, now)) continue;
    batch.update(row.ref, {
      status: "superseded",
      supersededAt: FieldValue.serverTimestamp(),
    });
    count++;
  }
  if (count > 0) {
    await batch.commit();
    logger.info("Superseded prior subscription rows", { businessId, count });
  }
}

export async function promoteDueScheduledSubscriptions(
  businessId: string,
): Promise<boolean> {
  const rows = await fetchRecentSubscriptionRows(businessId);
  const now = new Date();
  let promoted = false;

  const due = rows.filter((row) => {
    if (String(row.data.status || "") !== "scheduled") return false;
    const at = getActivatesAt(row.data);
    if (!at || at > now) return false;
    return paymentReadyForActivation(row.data);
  });

  for (const row of due) {
    await supersedeOtherEntitlingRows(businessId, row.ref, rows, now);
    const cycle = String(row.data.billingCycle || "monthly");
    const billingCycle: "monthly" | "yearly" =
      cycle === "yearly" ? "yearly" : "monthly";
    const activatesAt = getActivatesAt(row.data) ?? now;
    const { expiresAt, gracePeriodExpiresAt } = calculatePeriodDates(
      activatesAt,
      billingCycle,
    );
    await row.ref.update({
      "status": "active",
      "dates.activatedAt": Timestamp.fromDate(activatesAt),
      "dates.expiresAt": Timestamp.fromDate(expiresAt),
      "dates.renewalAt": Timestamp.fromDate(expiresAt),
      "dates.gracePeriodExpiresAt": Timestamp.fromDate(gracePeriodExpiresAt),
    });

    const metadata = row.data.metadata as Record<string, unknown> | undefined;
    if (metadata?.changeType === "downgrade") {
      const { deactivateAllNonOwnerWorkspaceMembers } = await import(
        "../team/team-member-downgrade-policy"
      );
      const { CustomerActiveLimitService } = await import(
        "../customers/customer-active-limit-service"
      );
      await deactivateAllNonOwnerWorkspaceMembers(businessId);
      await CustomerActiveLimitService.applyPlanDowngradeActivePolicyForBusiness(
        businessId,
      );
    }

    promoted = true;
    logger.info("Promoted scheduled subscription", {
      businessId,
      subscriptionId: row.id,
    });
  }

  return promoted;
}
