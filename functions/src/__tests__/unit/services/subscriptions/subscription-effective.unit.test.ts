import { describe, it, expect } from "vitest";
import {
  calculatePeriodDates,
  computeDatesView,
  isEntitlingRow,
  pickEffectiveEntitling,
  pickPendingScheduled,
  pickPendingPaidUpgrade,
  resolveRenewalDeferUntil,
  shouldDeferRenewalToPeriodEnd,
  paymentReadyForActivation,
  type SubscriptionDocRow,
} from "../../../../services/subscriptions/subscription-effective";

function row(
  id: string,
  data: Record<string, unknown>,
): SubscriptionDocRow {
  return { id, ref: {} as SubscriptionDocRow["ref"], data };
}

describe("subscription-effective", () => {
  describe("computeDatesView", () => {
    it("trial is expired after expiresAt with no grace period", () => {
      const expires = new Date("2026-05-10T00:00:00Z");
      const view = computeDatesView(
        {
          billingCycle: "trial",
          status: "active",
          dates: { expiresAt: expires, gracePeriodExpiresAt: new Date("2026-05-20T00:00:00Z") },
        },
        new Date("2026-05-11T00:00:00Z"),
      );
      expect(view.status).toBe("expired");
      expect(view.isExpired).toBe(true);
      expect(view.isGracePeriod).toBe(false);
    });

    it("paid plan enters grace after expiresAt", () => {
      const expires = new Date("2026-05-10T00:00:00Z");
      const grace = new Date("2026-05-17T00:00:00Z");
      const view = computeDatesView(
        {
          billingCycle: "monthly",
          status: "active",
          dates: { expiresAt: expires, gracePeriodExpiresAt: grace },
        },
        new Date("2026-05-12T00:00:00Z"),
      );
      expect(view.status).toBe("grace_period");
      expect(view.isGracePeriod).toBe(true);
      expect(view.isExpired).toBe(false);
    });
  });

  describe("shouldDeferRenewalToPeriodEnd", () => {
    it("defers RENEW while paid period is still active", () => {
      const expires = new Date("2026-05-28T00:00:00Z");
      const now = new Date("2026-05-26T00:00:00Z");
      const current = row("cur", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        dates: {
          expiresAt: expires,
          gracePeriodExpiresAt: new Date("2026-06-04T00:00:00Z"),
        },
      });
      const defer = shouldDeferRenewalToPeriodEnd("RENEW", current, now);
      expect(defer?.toISOString()).toBe(expires.toISOString());
    });

    it("does not defer RENEW on trial", () => {
      const current = row("trial", {
        billingCycle: "trial",
        status: "active",
        dates: { expiresAt: new Date("2026-05-28T00:00:00Z") },
      });
      expect(
        shouldDeferRenewalToPeriodEnd("RENEW", current, new Date("2026-05-20T00:00:00Z")),
      ).toBeNull();
    });

    it("defers UPGRADE from paid Grow while period is still active", () => {
      const expires = new Date("2026-05-28T00:00:00Z");
      const current = row("grow", {
        billingCycle: "monthly",
        status: "active",
        planCode: "grow",
        paymentStatus: "verified",
        dates: {
          expiresAt: expires,
          gracePeriodExpiresAt: new Date("2026-06-04T00:00:00Z"),
        },
      });
      const defer = shouldDeferRenewalToPeriodEnd(
        "UPGRADE",
        current,
        new Date("2026-05-20T00:00:00Z"),
      );
      expect(defer?.toISOString()).toBe(expires.toISOString());
    });

    it("does not defer UPGRADE from Starter", () => {
      const current = row("starter", {
        billingCycle: "monthly",
        status: "active",
        planCode: "starter",
        dates: {
          expiresAt: new Date("2026-05-28T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-06-04T00:00:00Z"),
        },
      });
      expect(
        shouldDeferRenewalToPeriodEnd("UPGRADE", current, new Date("2026-05-20T00:00:00Z")),
      ).toBeNull();
    });

    it("defers DOWNGRADE while paid period is still active", () => {
      const expires = new Date("2026-05-28T00:00:00Z");
      const current = row("cur", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        dates: {
          expiresAt: expires,
          gracePeriodExpiresAt: new Date("2026-06-04T00:00:00Z"),
        },
      });
      const defer = shouldDeferRenewalToPeriodEnd(
        "DOWNGRADE",
        current,
        new Date("2026-05-26T00:00:00Z"),
      );
      expect(defer?.toISOString()).toBe(expires.toISOString());
    });
  });

  describe("resolveRenewalDeferUntil", () => {
    it("stacks a second renewal after an already-queued August period", () => {
      const now = new Date("2026-07-15T00:00:00Z");
      const current = row("active-scale", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        paymentStatus: "verified",
        dates: {
          expiresAt: new Date("2026-08-07T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-08-14T00:00:00Z"),
        },
      });
      const queuedAugust = row("renewal-aug", {
        billingCycle: "monthly",
        status: "scheduled",
        planCode: "scale",
        paymentStatus: "verified",
        dates: {
          activatesAt: new Date("2026-08-07T00:00:00Z"),
          expiresAt: new Date("2026-09-07T00:00:00Z"),
        },
      });

      const defer = resolveRenewalDeferUntil(
        current,
        [queuedAugust, current],
        now,
        "scale",
        "monthly",
      );

      expect(defer?.toISOString()).toBe(new Date("2026-09-07T00:00:00Z").toISOString());
    });

    it("defers to current period end when no queued renewal exists", () => {
      const now = new Date("2026-07-15T00:00:00Z");
      const current = row("active-scale", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        paymentStatus: "verified",
        dates: {
          expiresAt: new Date("2026-08-07T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-08-14T00:00:00Z"),
        },
      });

      const defer = resolveRenewalDeferUntil(
        current,
        [current],
        now,
        "scale",
        "monthly",
      );

      expect(defer?.toISOString()).toBe(new Date("2026-08-07T00:00:00Z").toISOString());
    });
  });

  describe("pickEffectiveEntitling vs scheduled renewal", () => {
    it("keeps current paid row until scheduled activatesAt", () => {
      const now = new Date("2026-05-26T00:00:00Z");
      const current = row("active-scale", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        planName: "Scale",
        dates: {
          expiresAt: new Date("2026-05-28T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-06-04T00:00:00Z"),
        },
      });
      const scheduled = row("renewal", {
        billingCycle: "monthly",
        status: "scheduled",
        planCode: "scale",
        dates: {
          activatesAt: new Date("2026-05-28T00:00:00Z"),
          expiresAt: new Date("2026-06-28T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-07-05T00:00:00Z"),
        },
        paymentStatus: "verified",
      });
      const effective = pickEffectiveEntitling([scheduled, current], now);
      expect(effective?.id).toBe("active-scale");
      expect(pickPendingScheduled([scheduled, current], now)?.id).toBe("renewal");
    });

    it("returns null entitling when trial expired and no starter row", () => {
      const now = new Date("2026-05-11T00:00:00Z");
      const trial = row("trial", {
        billingCycle: "trial",
        status: "active",
        dates: { expiresAt: new Date("2026-05-10T00:00:00Z") },
      });
      expect(isEntitlingRow(trial.data, now)).toBe(false);
      expect(pickEffectiveEntitling([trial], now)).toBeNull();
    });

    it("does not treat approved renewal as the effective plan while current is active", () => {
      const now = new Date("2026-06-13T12:00:00Z");
      const current = row("active-scale", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        planName: "Scale",
        dates: {
          expiresAt: new Date("2026-08-07T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-08-14T00:00:00Z"),
        },
      });
      const approvedRenewal = row("renewal-approved", {
        billingCycle: "monthly",
        status: "approved",
        planCode: "scale",
        planName: "Scale",
        paymentStatus: "verified",
        dates: {
          activatesAt: new Date("2026-08-07T00:00:00Z"),
          expiresAt: new Date("2026-09-07T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-09-14T00:00:00Z"),
        },
      });

      expect(isEntitlingRow(approvedRenewal.data, now)).toBe(false);
      expect(pickEffectiveEntitling([approvedRenewal, current], now)?.id).toBe(
        "active-scale",
      );
      expect(pickPendingScheduled([approvedRenewal, current], now)?.id).toBe(
        "renewal-approved",
      );
    });
  });

  describe("calculatePeriodDates", () => {
    it("adds 7-day grace only for paid cycles", () => {
      const start = new Date("2026-05-01T00:00:00Z");
      const trial = calculatePeriodDates(start, "trial");
      expect(trial.gracePeriodExpiresAt.getTime()).toBe(trial.expiresAt.getTime());

      const monthly = calculatePeriodDates(start, "monthly");
      expect(monthly.gracePeriodExpiresAt.getTime()).toBeGreaterThan(
        monthly.expiresAt.getTime(),
      );
    });
  });

  describe("paymentReadyForActivation", () => {
    it("blocks promotion while payment is pending_verification", () => {
      expect(
        paymentReadyForActivation({ paymentStatus: "pending_verification", price: 100 }),
      ).toBe(false);
      expect(paymentReadyForActivation({ paymentStatus: "verified", price: 100 })).toBe(
        true,
      );
    });
  });

  describe("isEntitlingRow payment gate", () => {
    it("does not entitle paid plan while payment is pending_verification", () => {
      const now = new Date("2026-06-10T00:00:00Z");
      const pendingScale = row("scale-pending", {
        billingCycle: "monthly",
        status: "active",
        planCode: "scale",
        paymentStatus: "pending_verification",
        dates: {
          expiresAt: new Date("2026-07-10T00:00:00Z"),
          gracePeriodExpiresAt: new Date("2026-07-17T00:00:00Z"),
        },
      });
      expect(isEntitlingRow(pendingScale.data, now)).toBe(false);
    });

    it("does not entitle pending checkout row", () => {
      const now = new Date("2026-06-10T00:00:00Z");
      const pending = row("upgrade-pending", {
        billingCycle: "monthly",
        status: "pending",
        planCode: "scale",
        paymentStatus: "pending_verification",
      });
      expect(isEntitlingRow(pending.data, now)).toBe(false);
    });
  });

  describe("pickPendingPaidUpgrade", () => {
    it("finds pending Starter → Scale checkout awaiting ops", () => {
      const now = new Date("2026-06-10T00:00:00Z");
      const starter = row("starter", {
        billingCycle: "monthly",
        status: "superseded",
        planCode: "starter",
      });
      const pending = row("scale-pending", {
        billingCycle: "monthly",
        status: "pending",
        planCode: "scale",
        paymentStatus: "pending_verification",
      });
      expect(pickPendingPaidUpgrade([pending, starter], now)?.id).toBe("scale-pending");
    });
  });

  describe("calculatePeriodDates", () => {
    it("expires exactly one calendar month after activation", () => {
      const start = new Date("2026-06-12T11:52:44.635Z");
      const monthly = calculatePeriodDates(start, "monthly");
      expect(monthly.expiresAt.getMonth()).toBe(6);
      expect(monthly.expiresAt.getDate()).toBe(12);
    });

    it("expires exactly one calendar year after activation", () => {
      const start = new Date("2026-06-12T11:52:44.635Z");
      const yearly = calculatePeriodDates(start, "yearly");
      expect(yearly.expiresAt.getFullYear()).toBe(2027);
      expect(yearly.expiresAt.getMonth()).toBe(5);
      expect(yearly.expiresAt.getDate()).toBe(12);
    });
  });
});
