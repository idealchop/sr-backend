import { describe, expect, it } from "vitest";
import {
  computeCohortStats,
  computeDebtAgingBreakdown,
  computeRevenueTrend,
  computeRevenueWowPct,
  paginateRows,
  sumRevenue30d,
} from "../../../utils/analytics-utils";

describe("analytics-utils", () => {
  it("paginates rows with meta", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const page = paginateRows(rows, 2, 2);
    expect(page.data).toHaveLength(2);
    expect(page.meta.totalCount).toBe(5);
    expect(page.meta.totalPages).toBe(3);
  });

  it("computes debt aging buckets", () => {
    const now = new Date("2026-06-02");
    const result = computeDebtAgingBreakdown(
      [
        {
          customerId: "c1",
          type: "delivery",
          deliveryStatus: "delivered",
          paymentStatus: "unpaid",
          balanceDue: 100,
          scheduledAt: "2026-01-01",
          createdAt: "2026-01-01",
        } as any,
      ],
      [
        {
          id: "c1",
          name: "Ana",
          phone: "1",
          address: "A",
          type: "residential",
          businessId: "b1",
          status: "active",
          isDeliveryEnabled: true,
          isCollectionEnabled: false,
        },
      ],
      now,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.buckets.find((b) => b.id === "over_90")?.customerCount).toBe(1);
  });

  it("computes cohort stats for new vs returning", () => {
    const now = new Date("2026-06-15");
    const stats = computeCohortStats(
      [
        {
          customerId: "new",
          type: "walkin",
          paymentStatus: "paid",
          scheduledAt: "2026-06-10",
          createdAt: "2026-06-10",
        } as any,
        {
          customerId: "ret",
          type: "walkin",
          paymentStatus: "paid",
          scheduledAt: "2026-06-12",
          createdAt: "2026-06-12",
        } as any,
        {
          customerId: "ret",
          type: "walkin",
          paymentStatus: "paid",
          scheduledAt: "2026-05-01",
          createdAt: "2026-05-01",
        } as any,
      ],
      30,
      now,
    );
    expect(stats.newCount).toBe(1);
    expect(stats.returningCount).toBe(1);
  });

  it("sums 30-day revenue and WoW growth by payment date", () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    const transactions = [
      {
        type: "walkin",
        amountPaid: 100,
        scheduledAt: "2026-06-09",
        createdAt: "2026-06-09",
      },
      {
        type: "walkin",
        amountPaid: 50,
        scheduledAt: "2026-06-02",
        createdAt: "2026-06-02",
      },
      {
        type: "walkin",
        amountPaid: 200,
        scheduledAt: "2026-05-20",
        createdAt: "2026-05-20",
      },
    ] as any[];

    expect(sumRevenue30d(transactions, now)).toBe(350);
    const wow = computeRevenueWowPct(transactions, now);
    expect(wow).not.toBeNull();
  });

  it("builds revenue trend sparkline points", () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    const trend = computeRevenueTrend(
      [
        {
          type: "walkin",
          amountPaid: 100,
          scheduledAt: "2026-06-09",
          createdAt: "2026-06-09",
        } as any,
      ],
      7,
      now,
    );
    expect(trend.points).toHaveLength(7);
    expect(trend.today).toBeGreaterThanOrEqual(0);
    expect(trend.vsAvgLabel.length).toBeGreaterThan(0);
  });
});
