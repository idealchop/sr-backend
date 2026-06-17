import { describe, expect, it } from "vitest";
import {
  addManilaDays,
  buildDefaultMaintenanceTemplates,
  resolveMaintenanceTemplateStatus,
  summarizeMaintenanceOverdue,
} from "../../../../services/plant/maintenance-template-utils";
import type { MaintenanceTemplateRecord } from
  "../../../../services/plant/maintenance-template-types";

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
