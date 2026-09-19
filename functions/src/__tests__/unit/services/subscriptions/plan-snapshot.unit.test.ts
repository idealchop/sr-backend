import { describe, expect, it } from "vitest";
import {
  needsInitialCatalogSnapshot,
  shouldRefreshFreeCatalogSnapshot,
  buildPlanCatalogSnapshot,
  limitationsFromRowOrPlan,
} from "../../../../services/subscriptions/plan-snapshot";

describe("plan-snapshot", () => {
  it("stamps limitations and capabilities from the live plan", () => {
    const snap = buildPlanCatalogSnapshot(
      {
        code: "grow",
        limitations: { customers: "full" },
        capabilities: { map: "full", qrPortal: true },
        publishedAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-02T00:00:00.000Z",
      },
      new Date("2026-09-19T00:00:00.000Z"),
    );
    expect(snap.planLimitationsSnapshot).toEqual({ customers: "full" });
    expect(snap.planCapabilitiesSnapshot.map).toBe("full");
    expect(snap.planCapabilitiesSnapshot.qrPortal).toBe(true);
    expect(snap.catalogPublishedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refreshes Free snapshots only after live effectiveAt", () => {
    const now = new Date("2026-09-19T04:00:00Z");
    const live = {
      catalogStatus: "published",
      isActive: true,
      effectiveAt: "2026-09-19T00:00:00Z",
    };
    expect(
      shouldRefreshFreeCatalogSnapshot(
        { planCode: "free", billingCycle: "monthly", catalogEffectiveAt: "2026-09-01T00:00:00Z" },
        live,
        now,
      ),
    ).toBe(true);
    expect(
      shouldRefreshFreeCatalogSnapshot(
        { planCode: "scale", billingCycle: "monthly", catalogEffectiveAt: "2026-09-01T00:00:00Z" },
        live,
        now,
      ),
    ).toBe(false);
    expect(
      shouldRefreshFreeCatalogSnapshot(
        { planCode: "scale", billingCycle: "trial", catalogEffectiveAt: "2026-09-01T00:00:00Z" },
        live,
        now,
      ),
    ).toBe(false);
  });

  it("prefers the row snapshot over the live catalog", () => {
    expect(
      limitationsFromRowOrPlan(
        { planLimitationsSnapshot: { customers: { max: 100 } } },
        { limitations: { customers: "full" } },
      ),
    ).toEqual({ customers: { max: 100 } });
  });

  it("detects missing initial snapshots", () => {
    expect(needsInitialCatalogSnapshot({})).toBe(true);
    expect(needsInitialCatalogSnapshot({ planLimitationsSnapshot: { customers: "full" } })).toBe(
      false,
    );
  });
});
