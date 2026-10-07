import { describe, expect, it } from "vitest";
import {
  applyForecastHitToRollup,
  applyForecastMissToRollup,
  forecastMatchWindowClosed,
  forecastProductScore,
  forecastQtyScore,
  forecastRecommendedAction,
  isWithinForecastMatchWindow,
  pickForecastMatch,
  scoreForecastAccuracy,
} from "../../../utils/forecast-accuracy";
import {
  expandPreferredDaysToDateKeys,
  buildScheduleWeekSuggestions,
} from "../../../utils/forecast-schedule-week";

describe("forecast qty and product scores", () => {
  it("scores exact qty as 100 and half-miss as 50", () => {
    expect(forecastQtyScore(4, 4)).toBe(100);
    expect(forecastQtyScore(4, 2)).toBe(50);
    expect(forecastQtyScore(2, 0)).toBe(0);
  });

  it("weights product overlap and overall 70/30", () => {
    expect(forecastProductScore(
      [{ type: "Alkaline", qty: 5 }],
      [{ type: "Alkaline", qty: 5 }],
    )).toBe(100);
    expect(forecastProductScore(
      [{ type: "Alkaline", qty: 4 }, { type: "Purified", qty: 1 }],
      [{ type: "Alkaline", qty: 4 }],
    )).toBe(80);
    const scores = scoreForecastAccuracy(
      5,
      4,
      [{ type: "Alkaline", qty: 5 }],
      [{ type: "Alkaline", qty: 4 }],
    );
    expect(scores.qtyScore).toBe(80);
    expect(scores.productScore).toBe(80);
    expect(scores.overallScore).toBe(80);
  });
});

describe("forecast match window", () => {
  it("allows predicted date ±1 and closes after that", () => {
    expect(isWithinForecastMatchWindow(0)).toBe(true);
    expect(isWithinForecastMatchWindow(1)).toBe(true);
    expect(isWithinForecastMatchWindow(-1)).toBe(true);
    expect(isWithinForecastMatchWindow(2)).toBe(false);
    expect(forecastMatchWindowClosed("2026-09-21", "2026-09-22")).toBe(false);
    expect(forecastMatchWindowClosed("2026-09-21", "2026-09-23")).toBe(true);
  });

  it("picks smallest date delta then closest qty", () => {
    const pick = pickForecastMatch(
      { customerId: "c1", predictedDate: "2026-09-21", predictedQty: 5 },
      [
        {
          id: "far",
          customerId: "c1",
          type: "delivery",
          dateKey: "2026-09-22",
          qty: 5,
          items: [],
          alreadyScored: false,
        },
        {
          id: "near-wrong-qty",
          customerId: "c1",
          type: "delivery",
          dateKey: "2026-09-21",
          qty: 1,
          items: [],
          alreadyScored: false,
        },
        {
          id: "near-qty",
          customerId: "c1",
          type: "delivery",
          dateKey: "2026-09-21",
          qty: 5,
          items: [],
          alreadyScored: false,
        },
      ],
      new Set(),
    );
    expect(pick?.candidate.id).toBe("near-qty");
  });
});

describe("forecast rollup recommended action", () => {
  it("Save-first when rolling avg is 80+ with no miss in last 4", () => {
    let rollup = applyForecastHitToRollup(undefined, {
      predictedQty: 5,
      actualQty: 5,
      items: [{ type: "Alkaline", qty: 5 }],
      overallScore: 90,
      scoredAt: "2026-09-01T00:00:00.000Z",
    });
    rollup = applyForecastHitToRollup(rollup, {
      predictedQty: 5,
      actualQty: 5,
      items: [{ type: "Alkaline", qty: 5 }],
      overallScore: 85,
      scoredAt: "2026-09-08T00:00:00.000Z",
    });
    expect(forecastRecommendedAction(rollup)).toBe("save");
  });

  it("Call-first when last outcome missed or avg below 60", () => {
    const missed = applyForecastMissToRollup(undefined, "2026-09-08T00:00:00.000Z");
    expect(forecastRecommendedAction(missed)).toBe("call");
    const low = applyForecastHitToRollup(undefined, {
      predictedQty: 5,
      actualQty: 1,
      items: [{ type: "Alkaline", qty: 1 }],
      overallScore: 40,
      scoredAt: "2026-09-08T00:00:00.000Z",
    });
    expect(forecastRecommendedAction(low)).toBe("call");
  });
});

describe("preferred-day expansion", () => {
  it("expands Monday preferred days in a Manila week starting Monday", () => {
    const keys = expandPreferredDaysToDateKeys([1], "2026-09-21", 7);
    expect(keys).toEqual(["2026-09-21"]);
  });

  it("skips occupied slots and inactive sukis", () => {
    const rows = buildScheduleWeekSuggestions({
      customers: [
        {
          id: "inactive",
          name: "Off",
          status: "inactive",
          deliveryConfig: { preferredDays: [1] },
        },
        {
          id: "busy",
          name: "Busy",
          status: "active",
          deliveryConfig: { preferredDays: [1] },
        },
        {
          id: "free",
          name: "Free",
          status: "active",
          phone: "0917",
          deliveryConfig: { preferredDays: [1] },
        },
      ],
      occupiedSlots: [{ customerId: "busy", kind: "delivery", dateKey: "2026-09-21" }],
      windowStartKey: "2026-09-21",
      fallbackWaterType: "Alkaline",
    });
    expect(rows.map((row) => row.customerId)).toEqual(["free"]);
    expect(rows[0]?.predictedQty).toBe(2);
    expect(rows[0]?.predictedItems[0]?.type).toBe("Alkaline");
  });

  it("uses last 4 scored hit qty instead of a miss", () => {
    const rows = buildScheduleWeekSuggestions({
      customers: [
        {
          id: "suki",
          name: "Suki",
          status: "active",
          deliveryConfig: { preferredDays: [1] },
          forecastAccuracyRollup: {
            delivery: {
              hitCount: 2,
              missCount: 1,
              avgOverallScore: 90,
              lastPredictedQty: 5,
              lastActualQty: 6,
              lastOutcome: "missed",
              lastScoredAt: "2026-09-01T00:00:00.000Z",
              recentOutcomes: ["missed", "hit", "hit"],
              recentHits: [
                { qty: 6, items: [{ type: "Alkaline", qty: 6 }], overallScore: 90 },
                { qty: 4, items: [{ type: "Alkaline", qty: 4 }], overallScore: 90 },
              ],
            },
          },
        },
      ],
      occupiedSlots: [],
      windowStartKey: "2026-09-21",
    });
    expect(rows[0]?.predictedQty).toBe(5);
    expect(rows[0]?.recommendedAction).toBe("call");
  });
});
