import { describe, expect, it } from "vitest";
import {
  classifyPlantExpenseCategory,
  computePlantCostPerGallon,
  computePlantCostPerGallonForDays,
} from "../../../utils/plant-cost-per-gallon";
import type { ProductionShiftRecord } from "../../../services/plant/production-shift-types";

describe("plant-cost-per-gallon", () => {
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

  it("classifies plant expense categories", () => {
    expect(classifyPlantExpenseCategory("Maintenance")).toBe("maintenance");
    expect(classifyPlantExpenseCategory("Utilities")).toBe("electricity");
    expect(classifyPlantExpenseCategory("Filter cartridges")).toBe("consumables");
    expect(classifyPlantExpenseCategory("Gas")).toBeNull();
  });

  it("computes cost per gallon for date range", () => {
    const snapshot = computePlantCostPerGallon({
      shifts,
      transactions: [
        {
          type: "expense",
          expenseCategory: "Maintenance",
          totalAmount: 200,
          scheduledAt: "2026-06-12",
          createdAt: "2026-06-12",
        } as any,
        {
          type: "expense",
          expenseCategory: "Utilities",
          totalAmount: 300,
          scheduledAt: "2026-06-14",
          createdAt: "2026-06-14",
        } as any,
        {
          type: "expense",
          expenseCategory: "Filter cartridges",
          totalAmount: 100,
          scheduledAt: "2026-06-14",
          createdAt: "2026-06-14",
        } as any,
      ],
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-06-20T23:59:59.999Z"),
      periodLabel: "Jun 1–20",
    });

    expect(snapshot.gallonsProduced).toBe(800);
    expect(snapshot.maintenanceExpense).toBe(200);
    expect(snapshot.electricityExpense).toBe(300);
    expect(snapshot.consumablesExpense).toBe(100);
    expect(snapshot.totalExpense).toBe(600);
    expect(snapshot.costPerGallon).toBe(0.75);
  });

  it("returns null cost when no production gallons", () => {
    const snapshot = computePlantCostPerGallonForDays({
      shifts: [],
      transactions: [
        {
          type: "expense",
          expenseCategory: "Maintenance",
          totalAmount: 100,
          scheduledAt: "2026-06-10",
          createdAt: "2026-06-10",
        } as any,
      ],
      days: 30,
      now: new Date("2026-06-16T12:00:00+08:00"),
    });
    expect(snapshot.costPerGallon).toBeNull();
  });
});
