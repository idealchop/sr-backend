import { TransactionService } from "../transactions/transaction-service";

export type AccountantExportRow = {
  section: string;
  label: string;
  value: string | number;
};

export type AccountantExportPack = {
  businessId: string;
  month: string;
  format: "csv" | "pdf";
  rows: AccountantExportRow[];
  csvContent: string;
  pdfNote: string;
};

function monthRange(monthKey: string): { start: Date; end: Date } {
  const start = new Date(`${monthKey}-01T00:00:00+08:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

/**
 * SC-05 — monthly accountant export pack (CSV stub; PDF note for client download).
 */
export async function buildAccountantExportPack(params: {
  businessId: string;
  month: string;
  format?: "csv" | "pdf";
}): Promise<AccountantExportPack> {
  const format = params.format === "pdf" ? "pdf" : "csv";
  const { start, end } = monthRange(params.month);
  const transactions = await TransactionService.getTransactionsByBusiness(
    params.businessId,
    { limit: 500 },
  );

  let sales = 0;
  let collections = 0;
  let expenses = 0;
  const expenseByCategory = new Map<string, number>();
  let productionGallons = 0;

  for (const tx of transactions) {
    const raw = tx.scheduledAt ?? tx.createdAt;
    const d =
      typeof raw === "string" ? new Date(raw) :
        typeof (raw as { toDate?: () => Date }).toDate === "function" ?
          (raw as { toDate: () => Date }).toDate() :
          new Date(0);
    if (d < start || d >= end) continue;

    if (tx.type === "expense") {
      const amt = Number(tx.totalAmount) || 0;
      expenses += amt;
      const cat = String((tx as { category?: string }).category || "uncategorized");
      expenseByCategory.set(cat, (expenseByCategory.get(cat) || 0) + amt);
      continue;
    }
    if (tx.type === "collection") {
      collections += Number(tx.totalAmount) || 0;
      continue;
    }
    sales += Number(tx.totalAmount) || 0;
    for (const r of tx.waterRefills || []) {
      productionGallons += Number(r.quantity) || 0;
    }
  }

  const rows: AccountantExportRow[] = [
    { section: "summary", label: "Sales", value: Math.round(sales * 100) / 100 },
    { section: "summary", label: "Collections", value: Math.round(collections * 100) / 100 },
    { section: "summary", label: "Expenses", value: Math.round(expenses * 100) / 100 },
    { section: "production", label: "Refill units", value: productionGallons },
  ];

  for (const [cat, amt] of expenseByCategory) {
    rows.push({
      section: "expense_category",
      label: cat,
      value: Math.round(amt * 100) / 100,
    });
  }

  const csvLines = [
    "section,label,value",
    ...rows.map((r) => `${r.section},${JSON.stringify(r.label)},${r.value}`),
  ];

  return {
    businessId: params.businessId,
    month: params.month,
    format,
    rows,
    csvContent: csvLines.join("\n"),
    pdfNote:
      format === "pdf" ?
        "PDF generation stub — download CSV or wire PDF protocol for full pack." :
        "",
  };
}
