import type { ExtractedCustomerHistoryRow } from "../ai/customer-history-import-from-file-service";
import type { Transaction } from "../transactions/transaction-service";

export type CustomerHistoryImportRowStatus = "clean" | "flagged";

export type ProfiledHistoryImportRow = {
  index: number;
  transaction: ExtractedCustomerHistoryRow;
  status: CustomerHistoryImportRowStatus;
  issues: string[];
};

export type CustomerHistoryImportProfileResult = {
  rows: ProfiledHistoryImportRow[];
  summary: {
    total: number;
    clean: number;
    flagged: number;
  };
  canImportClean: boolean;
};

function txDateKey(tx: Transaction): string {
  const raw = tx.scheduledAt || tx.createdAt;
  if (!raw) return "";
  try {
    const d =
      typeof raw === "string" ? new Date(raw) : raw.toDate?.() || new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function rowFingerprint(row: ExtractedCustomerHistoryRow): string {
  const amt = Math.round(Number(row.amount) || 0);
  const qty = Math.round(Number(row.bottleQuantity) || 0);
  return `${row.date}|${row.transactionType}|${amt}|${qty}`;
}

function existingFingerprint(tx: Transaction): string {
  const amt = Math.round(Number(tx.totalAmount) || 0);
  const qty = Math.round(
    (tx.waterRefills || []).reduce((acc, r) => acc + (r.quantity || 0), 0),
  );
  return `${txDateKey(tx)}|${tx.type}|${amt}|${qty}`;
}

export class CustomerHistoryImportProfileService {
  static profileRows(
    rows: ExtractedCustomerHistoryRow[],
    existingTransactions: Transaction[],
  ): CustomerHistoryImportProfileResult {
    const existingKeys = new Set(
      existingTransactions
        .map((t) => existingFingerprint(t))
        .filter((k) => k.length > 8),
    );
    const fileSeen = new Map<string, number>();

    const profiled: ProfiledHistoryImportRow[] = rows.map((raw, index) => {
      const issues: string[] = [];
      const date = String(raw?.date || "").trim();
      const transactionType = raw?.transactionType;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        issues.push("Missing or invalid date (use YYYY-MM-DD).");
      }

      if (
        !transactionType ||
        !["delivery", "walkin", "collection", "expense"].includes(
          transactionType,
        )
      ) {
        issues.push("Invalid transaction type.");
      }

      const amount = Number(raw?.amount) || 0;
      const qty = Math.round(Number(raw?.bottleQuantity) || 0);

      if (transactionType === "expense" && amount <= 0) {
        issues.push("Expense rows need a positive amount.");
      } else if (transactionType === "collection") {
        issues.push(
          "Container collections are not auto-imported — use the Collection button " +
          "or import delivery/walk-in rows.",
        );
      } else if (
        transactionType &&
        transactionType !== "expense" &&
        amount <= 0 &&
        qty <= 0
      ) {
        issues.push("Need gallons/units or amount for this row.");
      }

      const transaction: ExtractedCustomerHistoryRow = {
        ...raw,
        date: date || raw.date,
        transactionType: transactionType || "delivery",
        bottleQuantity: qty > 0 ? qty : raw.bottleQuantity,
        amount: amount > 0 ? amount : raw.amount,
      };

      const fp = rowFingerprint(transaction);
      if (fp.length > 10) {
        const prior = fileSeen.get(fp);
        if (prior !== undefined) {
          issues.push(`Duplicate row in file (same as row ${prior + 1}).`);
        } else {
          fileSeen.set(fp, index);
        }
        if (existingKeys.has(fp)) {
          issues.push(
            "Likely duplicate of an existing history record for this customer.",
          );
        }
      }

      const status: CustomerHistoryImportRowStatus = issues.length ?
        "flagged" :
        "clean";
      return { index, transaction, status, issues };
    });

    const clean = profiled.filter((r) => r.status === "clean").length;
    const flagged = profiled.length - clean;

    return {
      rows: profiled,
      summary: { total: profiled.length, clean, flagged },
      canImportClean: clean > 0,
    };
  }
}
