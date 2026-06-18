import type { MaintenanceTemplateRecord } from "../services/plant/maintenance-template-types";
import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";
import { summarizeMaintenanceOverdue } from "../services/plant/maintenance-template-utils";

export type WrsMaintenanceGapRow = {
  customerId: string;
  customerName: string;
  avgWrsRating: number;
  overdueMaintenanceCount: number;
  insight: string;
};

/** MP-16 — correlate low WRS ratings with overdue plant maintenance. */
export function analyzeWrsMaintenanceGaps(args: {
  templates: MaintenanceTemplateRecord[];
  customers: Customer[];
  transactions: Transaction[];
}): {
  overdueCount: number;
  lowRatingCount: number;
  rows: WrsMaintenanceGapRow[];
  headline: string;
} {
  const overdue = summarizeMaintenanceOverdue(args.templates);
  const ratingsByCustomer = new Map<string, number[]>();

  for (const tx of args.transactions) {
    if (!tx.customerId) continue;
    const rating = tx.wrsRating ?? tx.serviceRating ?? tx.rating;
    if (rating == null || rating > 3) continue;
    const list = ratingsByCustomer.get(tx.customerId) ?? [];
    list.push(Number(rating));
    ratingsByCustomer.set(tx.customerId, list);
  }

  const customerName = new Map(args.customers.map((c) => [c.id, c.name]));
  const rows: WrsMaintenanceGapRow[] = [];

  for (const [customerId, ratings] of ratingsByCustomer) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg > 3) continue;
    rows.push({
      customerId,
      customerName: String(customerName.get(customerId) || "Customer"),
      avgWrsRating: Math.round(avg * 10) / 10,
      overdueMaintenanceCount: overdue.overdueCount,
      insight:
        overdue.overdueCount > 0 ?
          "Low station ratings while PM tasks are overdue — quality may be slipping." :
          "Low ratings with PM on schedule — check delivery timing or suki expectations.",
    });
  }

  rows.sort((a, b) => a.avgWrsRating - b.avgWrsRating);

  return {
    overdueCount: overdue.overdueCount,
    lowRatingCount: rows.length,
    rows: rows.slice(0, 10),
    headline:
      overdue.overdueCount > 0 && rows.length > 0 ?
        `${rows.length} suki${rows.length === 1 ? "" : "s"} rated ≤3★ while ${overdue.overdueCount} PM task${overdue.overdueCount === 1 ? "" : "s"} overdue.` :
        "No strong WRS vs maintenance gap signal this period.",
  };
}
