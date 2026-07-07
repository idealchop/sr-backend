import { describe, it, expect } from "vitest";
import {
  computeDatesView,
  isEntitlingRow,
} from "../../../../services/subscriptions/subscription-effective";

describe("trial pause", () => {
  it("paused trial does not entitle", () => {
    const expires = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-07-20T00:00:00Z");
    const data = {
      billingCycle: "trial",
      status: "active",
      planCode: "scale",
      metadata: { trialState: "paused", trialRemainingMs: 86400000 },
      dates: { expiresAt: expires },
    };
    expect(isEntitlingRow(data, now)).toBe(false);
  });

  it("running trial entitles before expiresAt", () => {
    const expires = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-07-20T00:00:00Z");
    const data = {
      billingCycle: "trial",
      status: "active",
      planCode: "scale",
      metadata: { trialState: "running" },
      dates: { expiresAt: expires },
    };
    expect(isEntitlingRow(data, now)).toBe(true);
  });
});

describe("paid grace lifecycle view", () => {
  it("enters grace after expiresAt before gracePeriodExpiresAt", () => {
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
    expect(view.isExpired).toBe(false);
  });

  it("expires after gracePeriodExpiresAt", () => {
    const expires = new Date("2026-05-10T00:00:00Z");
    const grace = new Date("2026-05-17T00:00:00Z");
    const view = computeDatesView(
      {
        billingCycle: "monthly",
        status: "grace_period",
        dates: { expiresAt: expires, gracePeriodExpiresAt: grace },
      },
      new Date("2026-05-18T00:00:00Z"),
    );
    expect(view.isExpired).toBe(true);
  });
});
