import { describe, expect, it } from "vitest";
import {
  MATERIALIZE_COALESCE_WINDOW_MS,
  canStartMaterializeRun,
  nextEligibleRunAtMs,
  parseMaterializeQueueDoc,
} from "../../../../services/analytics/analytics-materialize-coalesce";
import { diffDailyRollups, emptyDailyRollup } from
  "../../../../services/analytics/analytics-materialize-compute";

describe("analytics materialize coalescing", () => {
  const now = 1_000_000_000;

  it("runs immediately for a fresh business", () => {
    expect(canStartMaterializeRun(parseMaterializeQueueDoc(undefined), now)).toBe(true);
  });

  it("defers inside the window and while a lease is live", () => {
    expect(canStartMaterializeRun({ lastRunAtMs: now - 60_000 }, now)).toBe(false);
    const lastRunAtMs = now - MATERIALIZE_COALESCE_WINDOW_MS;
    expect(canStartMaterializeRun({ lastRunAtMs }, now)).toBe(true);
    expect(canStartMaterializeRun({ leaseUntilMs: now + 1 }, now)).toBe(false);
    expect(canStartMaterializeRun({ leaseUntilMs: now - 1 }, now)).toBe(true);
  });

  it("parses Firestore Timestamps and reports next eligible time", () => {
    const state = parseMaterializeQueueDoc({
      pending: true,
      seq: 4,
      lastRunAt: { toMillis: () => now },
      leaseUntil: null,
    });
    expect(state).toMatchObject({ pending: true, seq: 4, lastRunAtMs: now, leaseUntilMs: null });
    expect(nextEligibleRunAtMs(state)).toBe(now + MATERIALIZE_COALESCE_WINDOW_MS);
  });
});

describe("diffDailyRollups", () => {
  it("returns changed, new and emptied days only", () => {
    const day = (dateKey: string, revenueTotal: number) => ({
      ...emptyDailyRollup(dateKey), revenueTotal, revenueCash: revenueTotal, paymentCount: 1,
    });
    const before = new Map([["2026-11-01", day("2026-11-01", 10)], ["2026-11-02", day("2026-11-02", 20)], ["2026-11-03", day("2026-11-03", 30)]]);
    const after = new Map([["2026-11-01", day("2026-11-01", 10)], ["2026-11-02", day("2026-11-02", 25)], ["2026-11-04", day("2026-11-04", 5)]]);
    expect(diffDailyRollups(before, after).map((d) => [d.dateKey, d.revenueTotal])).toEqual([
      ["2026-11-02", 25],
      ["2026-11-03", 0],
      ["2026-11-04", 5],
    ]);
  });
});
