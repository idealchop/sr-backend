import type { Transaction } from "./transaction-types";

const CORE_AUDIT_FIELDS: (keyof Transaction)[] = [
  "notes",
  "scheduledAt",
  "riderId",
  "totalAmount",
  "customerId",
  "items",
  "waterRefills",
  "collectionItems",
  "type",
  "balanceDue",
  "deliveryStatus",
  "paymentStatus",
  "amountPaid",
];

/** Fields present on `updates` that differ from `current` (for audit summaries). */
export function detectTransactionChangedFields(
  current: Transaction,
  updates: Partial<Transaction>,
): string[] {
  const changedFields: string[] = [];

  for (const field of CORE_AUDIT_FIELDS) {
    if (updates[field] === undefined) continue;
    const newVal = updates[field];
    const oldVal = current[field];

    if (typeof newVal === "object") {
      if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        changedFields.push(field);
      }
    } else if (newVal !== oldVal) {
      changedFields.push(field);
    }
  }

  return changedFields;
}

/** Prefer latest Edited:/Removed: stamp from payment notes (audit detail). */
export function extractPaymentCorrectionReason(
  payments: unknown,
): string | undefined {
  if (!Array.isArray(payments)) return undefined;
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    const notes = String(
      (payments[i] as { notes?: unknown } | null)?.notes || "",
    );
    const match = notes.match(/(?:Edited|Removed):\s*([^·]+)/i);
    const reason = match?.[1]?.trim();
    if (reason) return reason;
  }
  return undefined;
}
