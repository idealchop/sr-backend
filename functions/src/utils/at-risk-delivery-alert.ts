import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";

const TERMINAL_DELIVERY = new Set([
  "delivered",
  "completed",
  "collected",
  "cancelled",
  "failed",
]);

export type AtRiskDeliveryRow = {
  customerId: string;
  customerName: string;
  reasons: string[];
};

export type AtRiskDeliverySnapshot = {
  count: number;
  rows: AtRiskDeliveryRow[];
};

function customerHasIncompleteTransaction(
  transactions: Transaction[],
  customerId: string,
): boolean {
  return transactions.some((tx) => {
    if (tx.customerId !== customerId) return false;
    const status = String(tx.deliveryStatus || "").toLowerCase();
    if (!status) return false;
    return !TERMINAL_DELIVERY.has(status);
  });
}

/** NT-08 — open deliveries and customers with pending operational activity. */
export function buildAtRiskDeliverySnapshot(
  transactions: Transaction[],
  customers: Customer[],
  pendingSubmissionCustomerIds: Set<string> = new Set(),
): AtRiskDeliverySnapshot {
  const customerNameById = new Map(
    customers.filter((c) => c.id).map((c) => [c.id!, c.name]),
  );
  const atRiskIds = new Set<string>();
  const reasonsByCustomer = new Map<string, string[]>();

  const pushReason = (customerId: string, line: string) => {
    const cur = reasonsByCustomer.get(customerId) ?? [];
    if (!cur.includes(line)) cur.push(line);
    reasonsByCustomer.set(customerId, cur);
    atRiskIds.add(customerId);
  };

  for (const tx of transactions) {
    if (tx.type !== "delivery" || !tx.customerId) continue;
    const status = String(tx.deliveryStatus || "").toLowerCase();
    if (!status || TERMINAL_DELIVERY.has(status)) continue;
    const ref = String(tx.referenceId || tx.id || "").slice(0, 12);
    pushReason(tx.customerId, `Delivery ${ref}: ${status.replace(/-/g, " ")}`);
  }

  for (const customer of customers) {
    if (!customer.id) continue;
    if (
      customerHasIncompleteTransaction(transactions, customer.id) ||
      pendingSubmissionCustomerIds.has(customer.id)
    ) {
      pushReason(
        customer.id,
        "Pending portal or submission activity on file.",
      );
    }
  }

  const rows: AtRiskDeliveryRow[] = [...atRiskIds].map((customerId) => ({
    customerId,
    customerName:
      String(customerNameById.get(customerId) || "Customer").trim() ||
      "Customer",
    reasons: reasonsByCustomer.get(customerId) ?? [],
  }));

  return { count: rows.length, rows };
}
