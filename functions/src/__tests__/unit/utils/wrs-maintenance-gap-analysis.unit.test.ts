import { describe, expect, it } from "vitest";
import {
  analyzeWrsMaintenanceGaps,
  countFailedTdsPriorToRating,
  wasPmOverdueAt,
  WRS_GAP_PRIOR_DAYS,
} from "../../../utils/wrs-maintenance-gap-analysis";
import type { MaintenanceTemplateRecord } from
  "../../../services/plant/maintenance-template-types";
import type { WaterQualityLogRecord } from
  "../../../services/plant/water-quality-log-service";
import type { Transaction } from "../../../services/transactions/transaction-service";

const now = new Date("2026-06-21T12:00:00+08:00");

function template(nextDueAt: string, status: MaintenanceTemplateRecord["status"] = "overdue"):
  MaintenanceTemplateRecord {
  return {
    id: "uv_lamp",
    slug: "uv_lamp",
    name: "UV lamp",
    intervalDays: 365,
    dueAfterGallons: null,
    gallonsSinceLastComplete: 0,
    lastCompletedAt: null,
    nextDueAt,
    status,
    dueTrigger: "calendar",
    checklist: [],
    consumes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function lowWrsTx(args: {
  customerId: string;
  wrsRating: number;
  at: string;
}): Transaction {
  return {
    businessId: "biz1",
    referenceId: `ref-${args.customerId}`,
    type: "walkin",
    customerId: args.customerId,
    customerName: "Suki",
    totalAmount: 100,
    amountPaid: 100,
    balanceDue: 0,
    paymentStatus: "paid",
    paymentMethod: "cash",
    deliveryStatus: "completed",
    wrsRating: args.wrsRating,
    scheduledAt: args.at,
  };
}

describe("wrs-maintenance-gap-analysis", () => {
  it("detects PM overdue at rating date", () => {
    expect(
      wasPmOverdueAt([template("2026-06-10")], new Date("2026-06-15T08:00:00+08:00")),
    ).toBe(true);
    expect(
      wasPmOverdueAt([template("2026-07-01", "ok")], new Date("2026-06-15T08:00:00+08:00")),
    ).toBe(false);
  });

  it("counts failed product TDS in the 14 days before a rating", () => {
    const ratingDate = new Date("2026-06-20T08:00:00+08:00");
    const logs: WaterQualityLogRecord[] = [
      {
        id: "1",
        recordedAt: "2026-06-19T08:00:00.000Z",
        tdsPpm: 45,
        locationTag: "product",
        source: "manual",
        pass: false,
      },
      {
        id: "2",
        recordedAt: "2026-05-01T08:00:00.000Z",
        tdsPpm: 45,
        locationTag: "product",
        source: "manual",
        pass: false,
      },
    ];
    expect(countFailedTdsPriorToRating(logs, ratingDate, WRS_GAP_PRIOR_DAYS)).toBe(1);
  });

  it("correlates low WRS with overdue PM within prior 14 days", () => {
    const result = analyzeWrsMaintenanceGaps({
      templates: [template("2026-06-10")],
      customers: [{ id: "c1", name: "Ana", businessId: "biz1" }],
      transactions: [
        lowWrsTx({
          customerId: "c1",
          wrsRating: 2,
          at: "2026-06-18T08:00:00+08:00",
        }),
      ],
      qualityLogs: [],
      now,
    });

    expect(result.lowRatingCount).toBe(1);
    expect(result.correlatedCount).toBe(1);
    expect(result.rows[0]?.correlated).toBe(true);
    expect(result.footerInsight).toContain("followed overdue PM");
  });

  it("correlates low WRS with failed TDS in prior 14 days", () => {
    const result = analyzeWrsMaintenanceGaps({
      templates: [template("2026-08-01", "ok")],
      customers: [{ id: "c1", name: "Ben", businessId: "biz1" }],
      transactions: [
        lowWrsTx({
          customerId: "c1",
          wrsRating: 3,
          at: "2026-06-18T08:00:00+08:00",
        }),
      ],
      qualityLogs: [
        {
          id: "q1",
          recordedAt: "2026-06-16T08:00:00.000Z",
          tdsPpm: 50,
          locationTag: "product",
          source: "manual",
          pass: false,
        },
      ],
      now,
    });

    expect(result.correlatedCount).toBe(1);
    expect(result.failedTdsCount).toBe(1);
    expect(result.rows[0]?.failedTdsPrior14Days).toBe(1);
  });

  it("ignores transactions without wrsRating", () => {
    const result = analyzeWrsMaintenanceGaps({
      templates: [],
      customers: [],
      transactions: [
        {
          ...lowWrsTx({ customerId: "c1", wrsRating: 2, at: "2026-06-18T08:00:00+08:00" }),
          wrsRating: undefined,
          serviceRating: 2,
        },
      ],
      qualityLogs: [],
      now,
    });

    expect(result.lowRatingCount).toBe(0);
  });
});
