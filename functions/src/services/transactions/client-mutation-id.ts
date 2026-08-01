import { db } from "../../config/firebase-admin";
import type { Transaction, TransactionPayment } from "./transaction-types";

const MAX_CLIENT_MUTATION_ID_LENGTH = 128;

function paymentDateMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validates an offline / client idempotency key for use as a Firestore doc id.
 */
export function normalizeClientMutationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > MAX_CLIENT_MUTATION_ID_LENGTH) return null;
  if (id.includes("/")) return null;
  if (id === "." || id === "..") return null;
  return id;
}

/**
 * Finds an existing transaction created with the same offline `clientMutationId`.
 */
export async function findTransactionByClientMutationId(
  businessId: string,
  clientMutationId: string,
): Promise<Transaction | null> {
  const id = normalizeClientMutationId(clientMutationId);
  if (!id) return null;

  const directRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(id);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    return { id: directSnap.id, ...directSnap.data() } as Transaction;
  }

  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("clientMutationId", "==", id)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() } as Transaction;
}

function paymentRowsMatch(
  next: Pick<TransactionPayment, "id" | "amount" | "date" | "method" | "voided">,
  existing: Pick<TransactionPayment, "id" | "amount" | "date" | "method" | "voided">,
): boolean {
  if (Math.abs(Number(next.amount) - Number(existing.amount)) >= 0.0001) {
    return false;
  }
  if (String(next.method || "") !== String(existing.method || "")) {
    return false;
  }
  if (Boolean(next.voided) !== Boolean(existing.voided)) {
    return false;
  }

  const nextMs = paymentDateMs(next.date);
  const existingMs = paymentDateMs(existing.date);
  if (nextMs == null && existingMs == null) return true;
  if (nextMs == null || existingMs == null) return false;
  return nextMs === existingMs;
}

/**
 * True when a payment patch only re-sends rows already stored (idempotent retry).
 * Must stay false for payment corrections (date/method/amount) and for expense
 * date edits that re-send the same paid total with a new payment/scheduled date.
 */
export function isIdempotentPaymentPatch(
  current: Pick<Transaction, "payments" | "amountPaid">,
  updates: Pick<Transaction, "payments" | "amountPaid">,
): boolean {
  if (!updates.payments || updates.payments.length === 0) return false;

  const currentPayments = current.payments || [];
  const existingIds = new Set(
    currentPayments
      .map((row) => row.id)
      .filter((value): value is string => Boolean(value)),
  );

  const hasNewPayment = updates.payments.some(
    (row) => row.id && !existingIds.has(row.id),
  );
  if (hasNewPayment) return false;

  const currentPaid = Number(current.amountPaid) || 0;
  const nextPaid = Number(updates.amountPaid) || 0;
  if (Math.abs(currentPaid - nextPaid) >= 0.0001) return false;

  if (updates.payments.length !== currentPayments.length) return false;

  return updates.payments.every((row, index) => {
    const existing = row.id ?
      currentPayments.find((payment) => payment.id === row.id) :
      currentPayments[index];
    if (!existing) return false;
    return paymentRowsMatch(row, existing);
  });
}
