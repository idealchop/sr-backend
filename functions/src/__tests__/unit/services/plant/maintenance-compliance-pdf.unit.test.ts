import { describe, expect, it } from "vitest";
import {
  buildMaintenanceCompliancePdf,
  summarizeQualityForCompliance,
} from "../../../../services/plant/maintenance-compliance-pdf-service";
import type { MaintenanceTemplateRecord } from
  "../../../../services/plant/maintenance-template-types";

describe("maintenance-compliance-pdf-service", () => {
  const overdueTemplate: MaintenanceTemplateRecord = {
    id: "sediment_filter",
    slug: "sediment_filter",
    name: "Sediment filter",
    intervalDays: 30,
    checklist: [],
    consumes: [],
    lastCompletedAt: null,
    nextDueAt: "2026-06-01",
    dueAfterGallons: null,
    gallonsSinceLastComplete: 0,
    status: "overdue",
    dueTrigger: "calendar",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  it("summarizes quality logs for compliance export", () => {
    const summary = summarizeQualityForCompliance([
      {
        id: "1",
        recordedAt: "2026-06-20T08:00:00.000Z",
        tdsPpm: 12,
        locationTag: "product",
        source: "manual",
        pass: true,
      },
      {
        id: "2",
        recordedAt: "2026-06-19T08:00:00.000Z",
        tdsPpm: 45,
        locationTag: "product",
        source: "manual",
        pass: false,
      },
      {
        id: "3",
        recordedAt: "2026-06-18T08:00:00.000Z",
        tdsPpm: 200,
        locationTag: "reject",
        source: "manual",
      },
    ]);

    expect(summary.totalLogs).toBe(3);
    expect(summary.failedProductLogs).toBe(1);
    expect(summary.latestProductTds).toBe(12);
  });

  it("builds a PDF buffer with completion and quality sections", async () => {
    const buffer = await buildMaintenanceCompliancePdf({
      businessName: "Test Station",
      periodDays: 90,
      generatedAt: "Jun 21, 2026, 10:00 AM",
      completions: [
        {
          templateName: "UV lamp",
          completedAt: "2026-06-15T04:00:00.000Z",
          notes: "Replaced bulb",
          proofUrl: "https://example.com/proof.jpg",
        },
      ],
      qualitySummary: {
        totalLogs: 2,
        failedProductLogs: 0,
        latestProductTds: 10,
      },
      overdueTemplates: [overdueTemplate],
      recentQualityLogs: [
        {
          id: "q1",
          recordedAt: "2026-06-20T08:00:00.000Z",
          tdsPpm: 10,
          locationTag: "product",
          source: "manual",
          pass: true,
        },
      ],
    });

    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
