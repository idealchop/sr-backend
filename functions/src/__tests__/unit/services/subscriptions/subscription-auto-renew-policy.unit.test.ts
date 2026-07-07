import { describe, expect, it } from "vitest";
import {
  hasQueuedPaidRenewal,
  subscriptionRowEligibleForLinkRenewal,
  wantsAutoRenewFromPayload,
} from "../../../../services/subscriptions/subscription-auto-renew-policy";
import type { SubscriptionDocRow } from "../../../../services/subscriptions/subscription-effective";

function row(
  id: string,
  data: Record<string, unknown>,
): SubscriptionDocRow {
  return {
    id,
    ref: { path: `businesses/biz/subscriptions/${id}` } as never,
    data,
  };
}

describe("subscription auto-renew policy", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const expiresSoon = new Date("2026-08-07T12:00:00.000Z");

  const baseRow = row("sub-1", {
    planCode: "scale",
    billingCycle: "monthly",
    status: "active",
    paymentStatus: "verified",
    cancelAtPeriodEnd: false,
    dates: {
      expiresAt: expiresSoon,
      gracePeriodExpiresAt: new Date("2026-08-14T12:00:00.000Z"),
    },
  });

  it("allows link renewal when expiring within lead window", () => {
    expect(
      subscriptionRowEligibleForLinkRenewal({
        row: baseRow,
        now,
        leadDays: 3,
        hasActivePaymongoSubscription: false,
        hasPendingRenewIntent: false,
        hasQueuedPaidRenewal: false,
      }),
    ).toBe(true);
  });

  it("skips when cancelAtPeriodEnd is true", () => {
    expect(
      subscriptionRowEligibleForLinkRenewal({
        row: row("sub-2", {
          ...baseRow.data,
          cancelAtPeriodEnd: true,
        }),
        now,
        leadDays: 3,
        hasActivePaymongoSubscription: false,
        hasPendingRenewIntent: false,
        hasQueuedPaidRenewal: false,
      }),
    ).toBe(false);
  });

  it("skips when PayMongo subscription is already active", () => {
    expect(
      subscriptionRowEligibleForLinkRenewal({
        row: baseRow,
        now,
        leadDays: 3,
        hasActivePaymongoSubscription: true,
        hasPendingRenewIntent: false,
        hasQueuedPaidRenewal: false,
      }),
    ).toBe(false);
  });

  it("allows grace-period reminder when auto-renew is on", () => {
    const graceRow = row("sub-3", {
      ...baseRow.data,
      status: "grace_period",
      dates: {
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        gracePeriodExpiresAt: new Date("2026-08-10T00:00:00.000Z"),
      },
    });

    expect(
      subscriptionRowEligibleForLinkRenewal({
        row: graceRow,
        now: new Date("2026-08-05T00:00:00.000Z"),
        leadDays: 3,
        hasActivePaymongoSubscription: false,
        hasPendingRenewIntent: false,
        hasQueuedPaidRenewal: false,
      }),
    ).toBe(true);
  });

  it("detects queued paid renewal rows", () => {
    const rows = [
      row("current", baseRow.data),
      row("next", {
        planCode: "scale",
        status: "scheduled",
        paymentStatus: "verified",
        dates: { activatesAt: new Date("2026-08-08T00:00:00.000Z") },
      }),
    ];

    expect(hasQueuedPaidRenewal(rows, "scale", now)).toBe(true);
  });

  it("reads auto-renew intent from checkout payload", () => {
    expect(wantsAutoRenewFromPayload({ autoRenew: true })).toBe(true);
    expect(wantsAutoRenewFromPayload({ cancelAtPeriodEnd: false })).toBe(true);
    expect(wantsAutoRenewFromPayload({ cancelAtPeriodEnd: true })).toBe(false);
  });
});
