import type {
  ExtractedLedgerInventoryLine,
  ExtractedLedgerRow,
  LedgerTransactionType,
} from "./ledger-scan-types";
import { isWalkInCustomerName } from "./ledger-scan-customer-match";

const VALID_TYPES = new Set<LedgerTransactionType>([
  "delivery",
  "walkin",
  "collection",
  "expense",
]);

export function normalizeLedgerType(
  raw: unknown,
  row: Partial<ExtractedLedgerRow>,
): LedgerTransactionType {
  const s = String(raw || "")
    .toLowerCase()
    .trim();
  if (s === "sale") {
    if (isWalkInCustomerName(String(row.customerName || ""))) return "walkin";
    if (row.status === "Order Placed" || row.deliveryStatus === "pending") {
      return "delivery";
    }
    if (row.address && String(row.address).trim()) return "delivery";
    return "walkin";
  }
  if (s === "expense") return "expense";
  if (s === "deliver" || s === "delivery") return "delivery";
  if (s === "walk-in" || s === "walkin" || s === "walk_in" || s === "direct") {
    return "walkin";
  }
  if (s === "collect" || s === "collection" || s === "return") {
    return "collection";
  }
  if (s === "vendor" || s === "purchase") return "expense";
  if (VALID_TYPES.has(s as LedgerTransactionType)) {
    return s as LedgerTransactionType;
  }
  return "walkin";
}

export function normalizeLedgerRow(
  raw: Partial<ExtractedLedgerRow>,
  currentDate: string,
): ExtractedLedgerRow | null {
  const transactionType = normalizeLedgerType(raw.transactionType, raw);
  const date =
    typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim()) ?
      raw.date.trim() :
      currentDate;
  const bottleQuantity =
    typeof raw.bottleQuantity === "number" &&
    Number.isFinite(raw.bottleQuantity) ?
      Math.max(0, Math.round(raw.bottleQuantity)) :
      undefined;
  const amount =
    typeof raw.amount === "number" && Number.isFinite(raw.amount) ?
      Math.max(0, Number(raw.amount)) :
      undefined;

  if (transactionType === "expense" && (!amount || amount <= 0)) return null;
  if (
    transactionType !== "expense" &&
    transactionType !== "collection" &&
    (!amount || amount <= 0) &&
    (!bottleQuantity || bottleQuantity <= 0)
  ) {
    return null;
  }
  if (
    transactionType === "collection" &&
    (!bottleQuantity || bottleQuantity <= 0)
  ) {
    return null;
  }

  const deliveryStatus =
    raw.deliveryStatus === "pending" || raw.status === "Order Placed" ?
      "pending" :
      "delivered";

  return {
    transactionType,
    customerName: String(raw.customerName || "Walk-in Customer").trim(),
    customerPhone: raw.customerPhone ?
      String(raw.customerPhone).trim().slice(0, 32) :
      undefined,
    bottleQuantity,
    amount,
    date,
    address: raw.address ? String(raw.address).slice(0, 240) : undefined,
    deliveryStatus,
    paymentStatus: raw.paymentStatus,
    paymentMethod: raw.paymentMethod,
    notes: raw.notes ? String(raw.notes).slice(0, 500) : undefined,
  };
}

export function attachInventoryIds(
  rows: { itemName: string; count: number }[],
  catalog: { id: string; name: string; category: string }[],
): ExtractedLedgerInventoryLine[] {
  const lower = (s: string) => s.toLowerCase().trim();
  return rows.map((row) => {
    const hit = catalog.find((c) => lower(c.name) === lower(row.itemName));
    if (hit) {
      return {
        itemName: hit.name,
        count: Math.max(0, Math.round(row.count)),
        inventoryItemId: hit.id,
        isNew: false,
      };
    }
    return {
      itemName: row.itemName,
      count: Math.max(0, Math.round(row.count)),
      inventoryItemId: "",
      isNew: true,
    };
  });
}

export const LEDGER_TX_SCHEMA_HINT =
  "Return JSON: { \"transactions\": array, \"inventoryLines\": array (optional), " +
  "\"parseWarnings\": string[] (optional) }. " +
  "Each transaction maps to Firestore businesses/{id}/transactions: " +
  "transactionType (delivery|walkin|collection|expense — map legacy 'Sale' from context), " +
  "customerName (string), customerPhone (optional), bottleQuantity (number), " +
  "amount (number PHP), date (YYYY-MM-DD), address (optional — used for new customer map pin), " +
  "deliveryStatus (delivered|pending), paymentStatus (paid|partial|unpaid), " +
  "paymentMethod (Cash|Online Payment|Not Paid), notes (optional). " +
  "For expense: customerName is vendor, omit bottleQuantity. " +
  "For collection: bottleQuantity is empty containers returned. " +
  "Each inventoryLine maps to inventory_items stock adjust: itemName (match catalog), " +
  "count (number). Skip header-only lines.";
