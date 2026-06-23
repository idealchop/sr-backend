import type { Transaction } from "../services/transactions/transaction-service";
import type { ProductionShiftRecord } from "../services/plant/production-shift-types";
import { manilaDateKey } from "./philippine-datetime";

export type PlantExpenseBucket = "maintenance" | "electricity" | "consumables";

export type PlantCostPerGallonSnapshot = {
  periodLabel: string;
  gallonsProduced: number;
  maintenanceExpense: number;
  electricityExpense: number;
  consumablesExpense: number;
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

/** Classify ledger expense categories that count toward plant ₱/gal (MP-13). */
export function classifyPlantExpenseCategory(
  category: string | undefined,
): PlantExpenseBucket | null {
  const c = String(category || "").toLowerCase();
  if (!c) return null;
  if (c.includes("maintenance")) return "maintenance";
  if (c.includes("electric") || c.includes("utilities") || c.includes("utility")) {
    return "electricity";
  }
  if (
    c.includes("consumable") ||
    c.includes("filter") ||
    c.includes("chemical") ||
    c.includes("sanitizer") ||
    c.includes("cartridge") ||
    c.includes("membrane") ||
    c.includes("uv") ||
    c.includes("plant supply")
  ) {
    return "consumables";
  }
  return null;
}

function sumGallonsInRange(
  shifts: ProductionShiftRecord[],
  startKey: string,
  endKey: string,
): number {
  return shifts.reduce((sum, shift) => {
    const key = String(shift.calendarDate || "");
    if (!key || key < startKey || key > endKey) return sum;
    return sum + Math.max(0, Number(shift.gallonsProduced) || 0);
  }, 0);
}

function sumPlantExpensesInRange(
  transactions: Transaction[],
  start: Date,
  end: Date,
): Pick<
  PlantCostPerGallonSnapshot,
  "maintenanceExpense" | "electricityExpense" | "consumablesExpense" | "totalExpense"
> {
  let maintenanceExpense = 0;
  let electricityExpense = 0;
  let consumablesExpense = 0;

  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const bucket = classifyPlantExpenseCategory(tx.expenseCategory);
    if (!bucket) continue;

    const d = parseDate(tx.scheduledAt) ?? parseDate(tx.createdAt);
    if (!d || d < start || d > end) continue;

    const amt = Number(tx.totalAmount) || 0;
    if (amt <= 0) continue;

    if (bucket === "maintenance") maintenanceExpense += amt;
    else if (bucket === "electricity") electricityExpense += amt;
    else consumablesExpense += amt;
  }

  return {
    maintenanceExpense,
    electricityExpense,
    consumablesExpense,
    totalExpense: maintenanceExpense + electricityExpense + consumablesExpense,
  };
}

/** MP-13 — cost per gallon from plant expenses ÷ production shift gallons. */
export function computePlantCostPerGallon(args: {
  shifts: ProductionShiftRecord[];
  transactions: Transaction[];
  start: Date;
  end: Date;
  periodLabel: string;
}): PlantCostPerGallonSnapshot {
  const startKey = manilaDateKey(args.start);
  const endKey = manilaDateKey(args.end);
  const gallonsProduced = sumGallonsInRange(args.shifts, startKey, endKey);
  const expenses = sumPlantExpensesInRange(args.transactions, args.start, args.end);

  const costPerGallon =
    gallonsProduced > 0 ?
      Math.round((expenses.totalExpense / gallonsProduced) * 100) / 100 :
      null;

  return {
    periodLabel: args.periodLabel,
    gallonsProduced,
    ...expenses,
    costPerGallon,
  };
}

export function computePlantCostPerGallonForDays(args: {
  shifts: ProductionShiftRecord[];
  transactions: Transaction[];
  days?: number;
  now?: Date;
}): PlantCostPerGallonSnapshot {
  const now = args.now ?? new Date();
  const days = args.days ?? 30;
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  return computePlantCostPerGallon({
    shifts: args.shifts,
    transactions: args.transactions,
    start,
    end,
    periodLabel: `Last ${days} days`,
  });
}
