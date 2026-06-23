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

/** Customer ids with pending portal place-order / collection submissions. */
export function pendingOrderCustomerIds(
  submissions: Array<{ customerId?: string; submissionType?: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const sub of submissions) {
    if (!sub.customerId) continue;
    const type = sub.submissionType;
    if (type === "PLACE_ORDER" || type === "REQUEST_COLLECTION") {
      ids.add(sub.customerId);
    }
  }
  return ids;
}

/** NT-08 — open deliveries and pending portal orders blocking win-back work. */
export function buildAtRiskDeliverySnapshot(
  transactions: Transaction[],
  customers: Customer[],
  pendingSubmissionCustomerIds: Set<string> = new Set(),
): AtRiskDeliverySnapshot {
  const customerNameById = new Map(
    customers
      .filter((c): c is typeof c & { id: string } =>
        typeof c.id === "string" && c.id.length > 0,
      )
      .map((c) => [c.id, c.name]),
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

  for (const customerId of pendingSubmissionCustomerIds) {
    if (atRiskIds.has(customerId)) continue;
    pushReason(
      customerId,
      "Pending portal order awaiting review.",
    );
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
