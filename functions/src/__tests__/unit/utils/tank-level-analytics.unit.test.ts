import { describe, expect, it } from "vitest";
import {
  buildTankLevelTrendSeries,
  buildTankLowLevelInsight,
  indexTankLogsByDay,
  TANK_LOW_LEVEL_PCT,
} from "../../../utils/tank-level-analytics";

describe("tank-level-analytics", () => {
  const now = new Date("2026-06-16T12:00:00+08:00");

  it("indexes latest log per Manila day", () => {
    const byDay = indexTankLogsByDay([
      { recordedAt: "2026-06-15T04:00:00+08:00", productPct: 40 },
      { recordedAt: "2026-06-15T20:00:00+08:00", productPct: 35 },
    ]);
    expect(byDay.get("2026-06-15")?.productPct).toBe(35);
  });

  it("builds 7-day trend series", () => {
    const points = buildTankLevelTrendSeries(
      [
        {
          recordedAt: "2026-06-14T08:00:00.000Z",
          rawPct: 80,
          productPct: 60,
          rejectPct: 5,
        },
        {
          recordedAt: "2026-06-16T08:00:00.000Z",
          rawPct: 70,
          productPct: 12,
        },
      ],
      7,
      now,
    );
    expect(points).toHaveLength(7);
    const today = points[points.length - 1];
    expect(today?.productPct).toBe(12);
  });

  it("builds low level insight for product and raw", () => {
    const insight = buildTankLowLevelInsight({
      latest: { recordedAt: "2026-06-16", rawPct: 10, productPct: 12 },
      threshold: TANK_LOW_LEVEL_PCT,
    });
    expect(insight).toContain("Product tank at 12%");
    expect(insight).toContain("Raw tank at 10%");
  });
});
