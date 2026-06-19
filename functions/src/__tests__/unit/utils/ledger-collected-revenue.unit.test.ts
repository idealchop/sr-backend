import { describe, expect, it } from "vitest";
import { buildWorkspaceRevenueMetrics } from "../../../utils/ledger-collected-revenue";
import type { Transaction } from "../../../services/transactions/transaction-service";

function tx(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "type">,
): Transaction {
  return {
    businessId: "biz1",
    referenceId: partial.referenceId ?? partial.id ?? "tx-1",
    customerName: "Customer",
    totalAmount: partial.totalAmount ?? 100,
    amountPaid: partial.amountPaid ?? 0,
    balanceDue: partial.balanceDue ?? 100,
    paymentStatus: partial.paymentStatus ?? "paid",
    paymentMethod: partial.paymentMethod ?? "cash",
    createdAt: partial.createdAt ?? "2026-06-10T08:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-06-10T08:00:00.000Z",
    ...partial,
  };
}

describe("buildWorkspaceRevenueMetrics", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("sums payments by Manila calendar day, not transaction schedule date", () => {
    const metrics = buildWorkspaceRevenueMetrics(
      [
        tx({
          id: "paid-today",
          type: "walkin",
          scheduledAt: "2026-06-09T08:00:00.000Z",
          payments: [
            { id: "p1", amount: 423, date: "2026-06-10T09:00:00.000Z", method: "cash" },
          ],
          amountPaid: 423,
          paymentStatus: "paid",
        }),
        tx({
          id: "paid-yesterday",
          type: "delivery",
          scheduledAt: "2026-06-10T08:00:00.000Z",
          payments: [
            { id: "p2", amount: 200, date: "2026-06-09T10:00:00.000Z", method: "cash" },
          ],
          amountPaid: 200,
          paymentStatus: "paid",
        }),
      ],
      now,
    );

    expect(metrics.todayPhp).toBe(423);
    expect(metrics.yesterdayPhp).toBe(200);
    expect(metrics.todayBreakdown.cashPhp).toBe(423);
  });

  it("includes expenses and net for today", () => {
    const metrics = buildWorkspaceRevenueMetrics(
      [
        tx({
          id: "sale",
          type: "walkin",
          payments: [
            { id: "p1", amount: 500, date: "2026-06-10T09:00:00.000Z", method: "cash" },
          ],
          amountPaid: 500,
          paymentStatus: "paid",
        }),
        tx({
          id: "expense",
          type: "expense",
          payments: [
            { id: "p2", amount: 100, date: "2026-06-10T11:00:00.000Z", method: "cash" },
          ],
          amountPaid: 100,
          paymentStatus: "paid",
          totalAmount: 100,
        }),
      ],
      now,
    );

    expect(metrics.todayPhp).toBe(500);
    expect(metrics.expensesTodayPhp).toBe(100);
    expect(metrics.netTodayPhp).toBe(400);
  });
});
