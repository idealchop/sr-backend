import { describe, expect, it } from "vitest";
import {
  hasQueuedPaidRenewal,
  subscriptionRowEligibleForLinkRenewal,
} from "../../../../services/subscriptions/subscription-auto-renew-policy";
import type { SubscriptionDocRow } from "../../../../services/subscriptions/subscription-effective";

function row(id: string, data: Record<string, unknown>): SubscriptionDocRow {
  return {
    id,
    ref: { path: `businesses/biz/subscriptions/${id}` } as never,
    data,
  };
}

describe("SubscriptionBillingService profile helpers", () => {
  it("eligible when expiring within lead window", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const eligible = subscriptionRowEligibleForLinkRenewal({
      row: row("s1", {
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
        paymentStatus: "verified",
        cancelAtPeriodEnd: false,
        dates: {
          expiresAt: new Date("2026-08-07T12:00:00.000Z"),
          gracePeriodExpiresAt: new Date("2026-08-14T12:00:00.000Z"),
        },
      }),
      now,
      leadDays: 3,
      hasActivePaymongoSubscription: false,
      hasPendingRenewIntent: false,
      hasQueuedPaidRenewal: false,
    });
    expect(eligible).toBe(true);
  });

  it("skips when queued paid renewal exists", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const rows = [
      row("s1", {
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
        paymentStatus: "verified",
        dates: {
          expiresAt: new Date("2026-08-07T12:00:00.000Z"),
          gracePeriodExpiresAt: new Date("2026-08-14T12:00:00.000Z"),
        },
      }),
      row("s2", {
        planCode: "scale",
        status: "scheduled",
        paymentStatus: "verified",
        dates: { activatesAt: new Date("2026-08-08T00:00:00.000Z") },
      }),
    ];
    expect(hasQueuedPaidRenewal(rows, "scale", now)).toBe(true);
  });
});
