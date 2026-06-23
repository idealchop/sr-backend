import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SubscriptionDocRow } from "../../../services/subscriptions/subscription-effective";
import { fetchRecentSubscriptionRows } from "../../../services/subscriptions/subscription-effective";
import { buildSubscriptionLifecycleSnapshot } from "../../../utils/subscription-lifecycle-alert";

vi.mock("../../../services/subscriptions/subscription-effective", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../services/subscriptions/subscription-effective")
    >();
  return {
    ...actual,
    fetchRecentSubscriptionRows: vi.fn(),
  };
});

function row(id: string, data: Record<string, unknown>): SubscriptionDocRow {
  return { id, ref: {} as SubscriptionDocRow["ref"], data };
}

describe("subscription-lifecycle-alert", () => {
  beforeEach(() => {
    vi.mocked(fetchRecentSubscriptionRows).mockReset();
  });

  it("returns inactive when plan is active with more than 7 days left", async () => {
    const now = new Date("2026-06-21T08:00:00+08:00");
    const expiresAt = new Date("2026-07-01T00:00:00+08:00");
    vi.mocked(fetchRecentSubscriptionRows).mockResolvedValue([
      row("sub1", {
        planName: "Scale",
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
        dates: {
          expiresAt,
          gracePeriodExpiresAt: new Date("2026-07-08T00:00:00+08:00"),
        },
      }),
    ]);

    const snapshot = await buildSubscriptionLifecycleSnapshot("b1", now);
    expect(snapshot.active).toBe(false);
    expect(snapshot.phase).toBeNull();
    expect(snapshot.headline).toBeNull();
  });

  it("flags expiring_7d within the 7-day window", async () => {
    const now = new Date("2026-06-21T08:00:00+08:00");
    const expiresAt = new Date("2026-06-25T00:00:00+08:00");
    vi.mocked(fetchRecentSubscriptionRows).mockResolvedValue([
      row("sub1", {
        planName: "Grow",
        planCode: "grow",
        billingCycle: "monthly",
        status: "active",
        dates: {
          expiresAt,
          gracePeriodExpiresAt: new Date("2026-07-02T00:00:00+08:00"),
        },
      }),
    ]);

    const snapshot = await buildSubscriptionLifecycleSnapshot("b1", now);
    expect(snapshot.active).toBe(true);
    expect(snapshot.phase).toBe("expiring_7d");
    expect(snapshot.headline).toContain("Grow");
    expect(snapshot.headline).toContain("4 day");
  });

  it("flags expiring_1d when expiry is tomorrow", async () => {
    const now = new Date("2026-06-21T08:00:00+08:00");
    const expiresAt = new Date("2026-06-22T08:00:00+08:00");
    vi.mocked(fetchRecentSubscriptionRows).mockResolvedValue([
      row("sub1", {
        planName: "Scale",
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
        dates: {
          expiresAt,
          gracePeriodExpiresAt: new Date("2026-06-29T08:00:00+08:00"),
        },
      }),
    ]);

    const snapshot = await buildSubscriptionLifecycleSnapshot("b1", now);
    expect(snapshot.active).toBe(true);
    expect(snapshot.phase).toBe("expiring_1d");
    expect(snapshot.headline).toContain("expires tomorrow");
  });

  it("flags expired when effective plan is past expiry", async () => {
    const now = new Date("2026-06-21T08:00:00+08:00");
    const expiresAt = new Date("2026-06-10T00:00:00+08:00");
    vi.mocked(fetchRecentSubscriptionRows).mockResolvedValue([
      row("sub1", {
        planName: "Scale",
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
        dates: {
          expiresAt,
          gracePeriodExpiresAt: new Date("2026-06-17T00:00:00+08:00"),
        },
      }),
    ]);

    const snapshot = await buildSubscriptionLifecycleSnapshot("b1", now);
    expect(snapshot.active).toBe(true);
    expect(snapshot.phase).toBe("expired");
    expect(snapshot.headline).toContain("has expired");
  });

  it("flags expired from history when no entitling row remains", async () => {
    const now = new Date("2026-06-21T08:00:00+08:00");
    vi.mocked(fetchRecentSubscriptionRows).mockResolvedValue([
      row("sub1", {
        planName: "Grow",
        planCode: "grow",
        billingCycle: "monthly",
        status: "expired",
        dates: {
          expiresAt: new Date("2026-06-01T00:00:00+08:00"),
          gracePeriodExpiresAt: new Date("2026-06-08T00:00:00+08:00"),
        },
      }),
    ]);

    const snapshot = await buildSubscriptionLifecycleSnapshot("b1", now);
    expect(snapshot.active).toBe(true);
    expect(snapshot.phase).toBe("expired");
    expect(snapshot.planName).toBe("Grow");
  });
});
