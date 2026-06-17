import { describe, expect, it } from "vitest";
import { buildInventoryReorderAlert } from "../../../utils/inventory-reorder-alert";
import type { InventoryItem } from "../../../services/inventory/inventory-service";

function inv(partial: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name: "Gallon",
    categoryId: "containers",
    stock: { current: 2, min: 10, unit: "pcs" },
    cost: 0,
    ...partial,
  };
}

describe("inventory-reorder-alert", () => {
  it("flags low stock before busiest weekday within window", () => {
    const now = new Date("2026-06-02T12:00:00+08:00"); // Tuesday Manila
    const alert = buildInventoryReorderAlert(
      [inv()],
      {
        periodDays: 30,
        busiestDayLabel: "Wed",
        busiestHourLabel: "9am",
        busiestDayCount: 40,
        busiestHourCount: 12,
        volumeByWeekday: [],
        volumeByHour: [],
      },
      now,
      3,
    );
    expect(alert.active).toBe(true);
    expect(alert.daysUntilPeak).toBe(1);
    expect(alert.headline).toMatch(/Gallon/);
  });
});
