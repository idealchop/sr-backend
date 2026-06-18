import type { Transaction } from "../services/transactions/transaction-service";
import type { ProductionShiftRecord } from "../services/plant/production-shift-types";

export type PlantCostPerGallonSnapshot = {
  periodLabel: string;
  gallonsProduced: number;
  maintenanceExpense: number;
  electricityExpense: number;
  totalExpense: number;
  costPerGallon: number | null;
};

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return null;
}

/** MP-13 — cost per gallon from expenses ÷ production shifts. */
export function computePlantCostPerGallon(args: {
  shifts: ProductionShiftRecord[];
  transactions: Transaction[];
  days?: number;
  now?: Date;
}): PlantCostPerGallonSnapshot {
  const now = args.now ?? new Date();
  const days = args.days ?? 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  const gallonsProduced = args.shifts
    .filter((s) => {
      const d = parseDate(s.calendarDate);
      return d && d >= start && d <= now;
    })
    .reduce((sum, s) => sum + (Number(s.gallonsProduced) || 0), 0);

  let maintenanceExpense = 0;
  let electricityExpense = 0;

  for (const tx of args.transactions) {
    if (tx.type !== "expense") continue;
    const d =
      parseDate(tx.scheduledAt) ?? parseDate(tx.createdAt);
    if (!d || d < start || d > now) continue;
    const cat = String(tx.expenseCategory || "").toLowerCase();
    const amt = Number(tx.totalAmount) || 0;
    if (cat.includes("maintenance")) maintenanceExpense += amt;
    else if (cat.includes("electric") || cat.includes("utilities")) {
      electricityExpense += amt;
    }
  }

  const totalExpense = maintenanceExpense + electricityExpense;
  const costPerGallon =
    gallonsProduced > 0 ?
      Math.round((totalExpense / gallonsProduced) * 100) / 100 :
      null;

  return {
    periodLabel: `Last ${days} days`,
    gallonsProduced,
    maintenanceExpense,
    electricityExpense,
    totalExpense,
    costPerGallon,
  };
}
