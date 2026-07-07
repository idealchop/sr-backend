import {
  computeDatesView,
  getActivatesAt,
  isPaidBillingCycle,
  paymentReadyForActivation,
  type SubscriptionDocRow,
} from "./subscription-effective";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AutoRenewSchedulerInput = {
  row: SubscriptionDocRow;
  now: Date;
  leadDays: number;
  hasActivePaymongoSubscription: boolean;
  hasPendingRenewIntent: boolean;
  hasQueuedPaidRenewal: boolean;
};

export function subscriptionRowEligibleForLinkRenewal(
  input: AutoRenewSchedulerInput,
): boolean {
  const { row, now, leadDays } = input;
  const data = row.data;
  const planCode = String(data.planCode || "").toLowerCase();
  const cycle = String(data.billingCycle || "").toLowerCase();

  if (
    !planCode ||
    planCode === "starter" ||
    planCode === "free" ||
    cycle === "trial" ||
    !isPaidBillingCycle(cycle)
  ) {
    return false;
  }

  if (data.cancelAtPeriodEnd === true) return false;
  if (input.hasActivePaymongoSubscription) return false;
  if (input.hasPendingRenewIntent) return false;
  if (input.hasQueuedPaidRenewal) return false;

  const view = computeDatesView(data, now);
  if (view.isExpired) return false;

  const windowEnd = new Date(now.getTime() + leadDays * MS_PER_DAY);
  const expiringSoon =
    view.expiresAt > now && view.expiresAt <= windowEnd;
  const inGrace = view.isGracePeriod && now > view.expiresAt;

  return expiringSoon || inGrace;
}

export function hasQueuedPaidRenewal(
  rows: SubscriptionDocRow[],
  planCode: string,
  now: Date,
): boolean {
  const target = planCode.trim().toLowerCase();
  return rows.some((row) => {
    if (String(row.data.status || "") !== "scheduled") return false;
    if (String(row.data.planCode || "").toLowerCase() !== target) return false;
    if (!paymentReadyForActivation(row.data)) return false;
    const activatesAt = getActivatesAt(row.data);
    return !!activatesAt && activatesAt > now;
  });
}

export function wantsAutoRenewFromPayload(
  payload: Record<string, unknown> | undefined,
): boolean {
  if (!payload) return false;
  if (payload.autoRenew === true) return true;
  return payload.cancelAtPeriodEnd === false;
}
