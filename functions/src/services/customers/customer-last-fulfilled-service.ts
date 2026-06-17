import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { Transaction } from "../transactions/transaction-service";

export type LastFulfilledType = "delivery" | "collection" | "walkin" | "direct_sale";

export type FulfilledActivity = {
  at: Date;
  type: LastFulfilledType;
};

function parseFirestoreDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null) {
    if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
      return (raw as { toDate: () => Date }).toDate();
    }
  }
  return null;
}

function isFulfilledTransaction(tx: Pick<Transaction, "type" | "deliveryStatus">): boolean {
  if (tx.type === "walkin" || tx.type === "direct_sale") return true;
  if (tx.type === "collection") {
    const ds = tx.deliveryStatus;
    if (!ds) return true;
    return ["delivered", "completed", "collected"].includes(ds);
  }
  if (tx.type === "delivery") {
    const ds = tx.deliveryStatus || "";
    return ["delivered", "completed", "collected"].includes(ds);
  }
  return false;
}

function fulfilledType(tx: Pick<Transaction, "type">): LastFulfilledType | null {
  if (tx.type === "collection") return "collection";
  if (tx.type === "walkin") return "walkin";
  if (tx.type === "direct_sale") return "direct_sale";
  if (tx.type === "delivery") return "delivery";
  return null;
}

type FulfilledTransactionFields = Pick<
  Transaction,
  "type" | "deliveryStatus" | "deliveredAt" | "updatedAt" | "scheduledAt" | "createdAt"
>;

/**
 * Resolve fulfilled activity timestamp and type from a transaction row.
 * @param {FulfilledTransactionFields} tx Transaction fields used for fulfillment detection.
 * @return {FulfilledActivity | null} Latest fulfilled activity, or null if not fulfilled.
 */
export function resolveFulfilledActivity(
  tx: FulfilledTransactionFields,
): FulfilledActivity | null {
  if (!isFulfilledTransaction(tx)) return null;
  const type = fulfilledType(tx);
  if (!type) return null;

  const at =
    parseFirestoreDate(tx.deliveredAt) ||
    parseFirestoreDate(tx.updatedAt) ||
    parseFirestoreDate(tx.scheduledAt) ||
    parseFirestoreDate(tx.createdAt);
  if (!at) return null;

  return { at, type };
}

/**
 * Updates `customers.lastFulfilledAt` / `lastFulfilledType` (and legacy `lastOrderAt`)
 * when the transaction represents a newer fulfilled activity.
 */
export class CustomerLastFulfilledService {
  static async touchFromTransaction(
    businessId: string,
    tx: Pick<
      Transaction,
      | "customerId"
      | "type"
      | "deliveryStatus"
      | "deliveredAt"
      | "updatedAt"
      | "scheduledAt"
      | "createdAt"
    >,
  ): Promise<void> {
    if (!tx.customerId) return;
    const activity = resolveFulfilledActivity(tx);
    if (!activity) return;

    try {
      const customerRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(tx.customerId);

      const snap = await customerRef.get();
      if (!snap.exists) return;

      const existing = parseFirestoreDate(snap.data()?.lastFulfilledAt) ??
        parseFirestoreDate(snap.data()?.lastOrderAt);
      if (existing && existing.getTime() >= activity.at.getTime()) return;

      await customerRef.update({
        lastFulfilledAt: activity.at,
        lastFulfilledType: activity.type,
        lastOrderAt: activity.at,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error("Failed to touch customer lastFulfilledAt", {
        businessId,
        customerId: tx.customerId,
        error,
      });
    }
  }

  /**
   * Recomputes last fulfilled activity per customer from ledger rows.
   * @param {string} businessId The business ID.
   * @param {Transaction[]} transactions Ledger rows to scan.
   * @param {Object} [options] Backfill options (onlyMissing skips existing rows).
   * @return {Promise<Object>} patched and scannedCustomers counts.
   */
  static async backfillBusiness(
    businessId: string,
    transactions: Transaction[],
    options: { onlyMissing?: boolean } = {},
  ): Promise<{ patched: number; scannedCustomers: number }> {
    const bestByCustomer = new Map<string, FulfilledActivity>();

    for (const tx of transactions) {
      if (!tx.customerId) continue;
      const activity = resolveFulfilledActivity(tx);
      if (!activity) continue;
      const prev = bestByCustomer.get(tx.customerId);
      if (!prev || activity.at.getTime() > prev.at.getTime()) {
        bestByCustomer.set(tx.customerId, activity);
      }
    }

    let patched = 0;
    for (const [customerId, activity] of bestByCustomer.entries()) {
      const customerRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId);
      const snap = await customerRef.get();
      if (!snap.exists) continue;

      const data = snap.data() || {};
      if (options.onlyMissing && data.lastFulfilledAt) continue;

      const existing = parseFirestoreDate(data.lastFulfilledAt) ??
        parseFirestoreDate(data.lastOrderAt);
      if (existing && existing.getTime() >= activity.at.getTime()) continue;

      await customerRef.update({
        lastFulfilledAt: activity.at,
        lastFulfilledType: activity.type,
        lastOrderAt: activity.at,
        updatedAt: FieldValue.serverTimestamp(),
      });
      patched += 1;
    }

    return { patched, scannedCustomers: bestByCustomer.size };
  }
}
