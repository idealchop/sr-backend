import { db } from "../config/firebase-admin";
import type { Transaction } from "../services/transactions/transaction-service";

export type PaymentInfoAccount = {
  id: string;
  bankName?: string;
  type?: string;
  isPrimary?: boolean;
};

const KNOWN_PAYMENT_METHODS = new Set([
  "cash",
  "bank_transfer",
  "digital_wallet",
  "other",
]);

function normalizePaymentAccountName(bankName: string): string {
  const normalized = (bankName || "").trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("gcash")) return "GCash";
  if (lower.includes("maya")) return "Maya";
  return normalized || "Transfer";
}

function resolveBusinessPaymentMethodLabel(
  method: string | undefined,
  accounts: PaymentInfoAccount[],
): string | null {
  const raw = (method || "cash").trim();
  if (!raw || raw === "cash") return "Cash";
  if (raw === "bank_transfer") return "Bank Transfer";
  if (raw === "digital_wallet") return "Digital Wallet";
  if (raw === "other") return "Other";

  const account = accounts.find((row) => row.id === raw);
  if (account?.bankName) {
    return normalizePaymentAccountName(account.bankName);
  }

  if (KNOWN_PAYMENT_METHODS.has(raw)) {
    return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return null;
}

function isOnlinePaymentMethod(method: string | undefined): boolean {
  const raw = (method || "cash").trim().toLowerCase();
  return raw !== "" && raw !== "cash";
}

function extractReferenceFromText(text: string): string | null {
  const patterns = [
    /Payment reference:\s*([^|\n]+)/i,
    /Payment ref:\s*([^|\n·]+)/i,
    /\bRef:\s*([^|\n·]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export function extractTransactionPaymentReference(
  transaction: Transaction,
): string | null {
  const payments = transaction.payments ?? [];
  for (let index = payments.length - 1; index >= 0; index -= 1) {
    const notes = payments[index]?.notes;
    if (!notes) continue;
    const ref = extractReferenceFromText(notes);
    if (ref) return ref;
  }

  if (transaction.notes) {
    return extractReferenceFromText(String(transaction.notes));
  }

  return null;
}

export type ReceiptPaymentDisplay = {
  paymentMethod: string;
  paymentReference: string | null;
};

export function resolveReceiptPaymentDisplay(
  transaction: Transaction,
  accounts: PaymentInfoAccount[],
): ReceiptPaymentDisplay {
  const paymentStatus = (transaction.paymentStatus || "unpaid")
    .trim()
    .toLowerCase();

  if (paymentStatus === "unpaid") {
    return { paymentMethod: "N/A", paymentReference: null };
  }

  const methodLabel =
    resolveBusinessPaymentMethodLabel(transaction.paymentMethod, accounts) ??
    "-";

  if (!isOnlinePaymentMethod(transaction.paymentMethod)) {
    return { paymentMethod: methodLabel, paymentReference: null };
  }

  const paymentReference = extractTransactionPaymentReference(transaction) ?? "-";
  return { paymentMethod: methodLabel, paymentReference };
}

export async function loadBusinessPaymentAccounts(
  businessId: string,
): Promise<PaymentInfoAccount[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("payment_info")
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<PaymentInfoAccount, "id">),
  }));
}
