import { describe, expect, it } from "vitest";
import {
  addManilaDays,
  buildDefaultMaintenanceTemplates,
  computePmGallonRecurrenceUpdate,
  resolveMaintenanceDueTrigger,
  resolveMaintenanceTemplateStatus,
  sumGallonsSinceLastComplete,
  summarizeMaintenanceOverdue,
} from "../../../../services/plant/maintenance-template-utils";
import type { MaintenanceTemplateRecord } from
  "../../../../services/plant/maintenance-template-types";
import type { ProductionShiftRecord } from
  "../../../../services/plant/production-shift-types";

describe("maintenance-template-utils", () => {
  const now = new Date("2026-06-16T12:00:00+08:00");

  it("adds Manila calendar days", () => {
    expect(addManilaDays("2026-06-16", 7)).toBe("2026-06-23");
  });

  it("seeds default PH maintenance templates", () => {
    const seeds = buildDefaultMaintenanceTemplates(now);
    expect(seeds).toHaveLength(6);
    expect(seeds[0]?.slug).toBe("sediment_filter");
    expect(seeds[0]?.lastCompletedAt).toBeNull();
    expect(seeds[0]?.nextDueAt).toBe("2026-07-16");
  });

  it("classifies overdue, due soon, and ok statuses", () => {
    expect(resolveMaintenanceTemplateStatus("2026-06-10", now)).toBe("overdue");
    expect(resolveMaintenanceTemplateStatus("2026-06-20", now)).toBe("due_soon");
    expect(resolveMaintenanceTemplateStatus("2026-07-01", now)).toBe("ok");
  });

  it("uses gallon threshold when production exceeds limit", () => {
    expect(
      resolveMaintenanceTemplateStatus("2026-07-01", now, {
        dueAfterGallons: 1000,
        gallonsSinceLastComplete: 1000,
      }),
    ).toBe("overdue");
    expect(
      resolveMaintenanceTemplateStatus("2026-07-01", now, {
        dueAfterGallons: 1000,
        gallonsSinceLastComplete: 950,
      }),
    ).toBe("due_soon");
    expect(resolveMaintenanceDueTrigger("2026-07-01", now, {
      dueAfterGallons: 1000,
      gallonsSinceLastComplete: 1000,
    })).toBe("gallons");
  });

  it("sums gallons since last PM completion", () => {
    const shifts: ProductionShiftRecord[] = [
      {
        id: "2026-06-10_AM",
        calendarDate: "2026-06-10",
        shift: "AM",
        gallonsProduced: 500,
        gallonsRejected: 0,
        source: "manual",
        recordedBy: "u1",
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
      },
      {
        id: "2026-06-15_AM",
        calendarDate: "2026-06-15",
        shift: "AM",
        gallonsProduced: 300,
        gallonsRejected: 0,
        source: "manual",
        recordedBy: "u1",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
    ];
    expect(sumGallonsSinceLastComplete(shifts, "2026-06-12T00:00:00.000Z")).toBe(300);
    expect(sumGallonsSinceLastComplete(shifts, null)).toBe(800);
  });

  it("computes gallon recurrence pull-forward when threshold exceeded", () => {
    const shifts: ProductionShiftRecord[] = [
      {
        id: "2026-06-16_AM",
        calendarDate: "2026-06-16",
        shift: "AM",
        gallonsProduced: 1200,
        gallonsRejected: 0,
        source: "manual",
        recordedBy: "u1",
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
      },
    ];
    const update = computePmGallonRecurrenceUpdate(
      {
        id: "nozzle_cleaning",
        dueAfterGallons: 1000,
        gallonsSinceLastComplete: 0,
        lastCompletedAt: "2026-06-01T00:00:00.000Z",
        nextDueAt: "2026-06-20",
      },
      shifts,
      "2026-06-16",
    );
    expect(update?.gallonsSinceLastComplete).toBe(1200);
    expect(update?.nextDueAt).toBe("2026-06-16");
  });

  it("summarizes overdue template names", () => {
    const rows: MaintenanceTemplateRecord[] = [
      {
        id: "uv_lamp",
        slug: "uv_lamp",
        name: "UV lamp",
        intervalDays: 365,
        lastCompletedAt: null,
        nextDueAt: "2026-06-01",
        status: "overdue",
        dueTrigger: "calendar",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "nozzle_cleaning",
        slug: "nozzle_cleaning",
        name: "Nozzle cleaning",
        intervalDays: 7,
        lastCompletedAt: "2026-06-14T00:00:00.000Z",
        nextDueAt: "2026-06-20",
        status: "due_soon",
        dueTrigger: "calendar",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      },
    ];
    expect(summarizeMaintenanceOverdue(rows)).toEqual({
      overdueCount: 1,
      dueSoonCount: 1,
      overdueNames: ["UV lamp"],
    });
  });
});
