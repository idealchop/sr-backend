import { describe, expect, it } from "vitest";
import {
  buildAnalyticsDailyRollups,
  manilaDayRangeKeys,
  sumAnalyticsDailyRange,
} from "../../../utils/analytics-daily-rollup";
import type { Transaction } from "../../../services/transactions/transaction-service";

describe("analytics-daily-rollup", () => {
  it("buckets revenue and expenses by Manila payment date", () => {
    const txs = [
      {
        type: "delivery",
        deliveryStatus: "delivered",
        payments: [
          { amount: 100, date: "2026-07-10T08:00:00+08:00", method: "cash" },
          { amount: 50, date: "2026-07-10T09:00:00+08:00", method: "gcash" },
        ],
      },
      {
        type: "expense",
        payments: [
          { amount: 20, date: "2026-07-10T10:00:00+08:00", method: "cash" },
        ],
      },
      {
        type: "walkin",
        deliveryStatus: "completed",
        amountPaid: 40,
        paymentMethod: "cash",
        createdAt: "2026-07-11T12:00:00+08:00",
        scheduledAt: "2026-07-11T12:00:00+08:00",
      },
    ] as unknown as Transaction[];

    const map = buildAnalyticsDailyRollups(txs);
    const day10 = map.get("2026-07-10");
    const day11 = map.get("2026-07-11");

    expect(day10?.revenueTotal).toBe(150);
    expect(day10?.revenueCash).toBe(100);
    expect(day10?.revenueOnline).toBe(50);
    expect(day10?.expensesTotal).toBe(20);
    expect(day11?.revenueTotal).toBe(40);

    const sum = sumAnalyticsDailyRange(map.values(), "2026-07-10", "2026-07-11");
    expect(sum.revenueTotal).toBe(190);
    expect(sum.expensesTotal).toBe(20);
    expect(sum.netTotal).toBe(170);
    expect(sum.dayCount).toBe(2);
  });

  it("builds inclusive Manila day range keys", () => {
    const { fromKey, toKey } = manilaDayRangeKeys(3, new Date("2026-07-13T12:00:00+08:00"));
    expect(toKey).toBe("2026-07-13");
    expect(fromKey).toBe("2026-07-11");
  });
});
