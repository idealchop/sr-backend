import { db } from "../../config/firebase-admin";
import type { Transaction } from "./transaction-service";

const MAX_CLIENT_MUTATION_ID_LENGTH = 128;

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

/**
 * True when a payment patch only re-sends rows already stored (idempotent retry).
 */
export function isIdempotentPaymentPatch(
  current: Pick<Transaction, "payments" | "amountPaid">,
  updates: Pick<Transaction, "payments" | "amountPaid">,
): boolean {
  if (!updates.payments || updates.payments.length === 0) return false;

  const existingIds = new Set(
    (current.payments || [])
      .map((row) => row.id)
      .filter((value): value is string => Boolean(value)),
  );

  const hasNewPayment = updates.payments.some(
    (row) => row.id && !existingIds.has(row.id),
  );
  if (hasNewPayment) return false;

  const currentPaid = Number(current.amountPaid) || 0;
  const nextPaid = Number(updates.amountPaid) || 0;
  return Math.abs(currentPaid - nextPaid) < 0.0001;
}
