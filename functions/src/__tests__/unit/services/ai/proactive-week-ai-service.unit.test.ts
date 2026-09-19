import { describe, expect, it } from "vitest";
import {
  mergeProactiveWeekSuggestions,
  summarizeCustomerOrderHabits,
  validateLlmProactiveWeekRow,
} from "../../../../services/ai/proactive-week-ai-service";
import type { ProactiveScheduleSuggestionInput } from "../../../../services/proactive-schedule/proactive-schedule-week-snapshot-service";

describe("proactive-week-ai-service", () => {
  const windowStart = new Date("2026-06-21T00:00:00+08:00");
  const windowEnd = new Date("2026-06-27T00:00:00+08:00");
  const mergeOpts = {
    allowedCustomerIds: new Set(["c1", "c2"]),
    customerNames: new Map([
      ["c1", "Ana"],
      ["c2", "Ben"],
    ]),
    windowStart,
    windowEnd,
  };

  const seed: ProactiveScheduleSuggestionInput[] = [
    {
      id: "hist-c1-delivery",
      customerId: "c1",
      customerName: "Ana",
      scheduledDate: windowStart.toISOString(),
      kind: "delivery",
      refillItems: [{ type: "Purified", qty: 2 }],
      returnContainers: [],
      rationale: "Median cadence · 2× Purified",
      source: "history",
    },
  ];

  it("overlays LLM date and reason onto deterministic row", () => {
    const merged = mergeProactiveWeekSuggestions(
      seed,
      [
        {
          ...seed[0],
          scheduledDate: "2026-06-23T12:00:00+08:00",
          reason: "Usually orders mid-week",
          refillItems: [{ type: "Purified", qty: 3 }],
        },
      ],
      mergeOpts,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].refillItems[0].qty).toBe(3);
    expect(merged[0].reason).toBe("Usually orders mid-week");
    expect(merged[0].source).toBe("history");
  });

  it("adds a habit-only customer the preferred-day seed did not include", () => {
    const merged = mergeProactiveWeekSuggestions(
      seed,
      [
        {
          id: "ai-c2-delivery",
          customerId: "c2",
          customerName: "Ben",
          scheduledDate: "2026-06-24",
          kind: "delivery",
          refillItems: [{ type: "Purified", qty: 4 }],
          returnContainers: [],
          rationale: "Usually orders Wednesdays",
        },
      ],
      mergeOpts,
    );
    expect(merged.map((row) => row.customerId).sort()).toEqual(["c1", "c2"]);
    expect(merged.find((row) => row.customerId === "c2")?.source).toBe("history");
  });

  it("rejects unknown customer ids from LLM output", () => {
    const merged = mergeProactiveWeekSuggestions(
      seed,
      [
        {
          id: "x",
          customerId: "unknown",
          customerName: "Ghost",
          scheduledDate: windowStart.toISOString(),
          kind: "delivery",
          refillItems: [{ type: "Purified", qty: 1 }],
          returnContainers: [],
          rationale: "bad",
        },
      ],
      mergeOpts,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].customerId).toBe("c1");
  });

  it("rejects scheduled dates outside the forecast window", () => {
    const row = validateLlmProactiveWeekRow(
      {
        id: "x",
        customerId: "c2",
        customerName: "Ben",
        scheduledDate: "2026-07-01",
        kind: "collection",
        refillItems: [],
        returnContainers: [],
        rationale: "late",
      },
      mergeOpts,
    );
    expect(row).toBeNull();
  });

  it("summarizes weekday habit from recent orders, not only preferredDays", () => {
    const habit = summarizeCustomerOrderHabits(
      {
        id: "c1",
        name: "Ana",
        isDeliveryEnabled: true,
        deliveryConfig: { preferredDays: [1] },
        lastFulfilledAt: "2026-06-24T04:00:00.000Z",
        lastFulfilledType: "delivery",
        forecastAccuracyRollup: {
          delivery: { hitCount: 3, missCount: 1 },
        },
      },
      [
        {
          customerId: "c1",
          type: "delivery",
          scheduledAt: "2026-06-03T04:00:00.000Z",
          waterRefills: [{ quantity: 2 }],
        },
        {
          customerId: "c1",
          type: "delivery",
          scheduledAt: "2026-06-10T04:00:00.000Z",
          waterRefills: [{ quantity: 2 }],
        },
        {
          customerId: "c1",
          type: "delivery",
          scheduledAt: "2026-06-17T04:00:00.000Z",
          waterRefills: [{ quantity: 4 }],
        },
      ],
    );
    expect(habit?.preferredDeliveryDays).toEqual([1]);
    expect(habit?.orderWeekdays["3"]).toBe(3);
    expect(habit?.typicalQty).toBe(2);
    expect(habit?.forecastHitRate).toBe(75);
    expect(habit?.lastFulfilledAt).toBe("2026-06-24");
  });
});
