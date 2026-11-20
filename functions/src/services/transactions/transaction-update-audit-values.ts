import type { Transaction } from "./transaction-types";

/**
 * Old and new values for the fields a transaction update changed, so the
 * history (Daily Ops Logs) can show "old -> new". `undefined` becomes `null`
 * because Firestore drops undefined values.
 */
export function buildTransactionUpdateAuditValues(
  current: Partial<Transaction>,
  updates: Partial<Transaction>,
  changedFields: string[],
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const field of changedFields) {
    const key = field as keyof Transaction;
    oldValues[field] = current[key] ?? null;
    newValues[field] = updates[key] ?? null;
  }
  return { oldValues, newValues };
}
