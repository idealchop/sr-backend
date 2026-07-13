import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { Customer } from "./customer-service";
import type { Transaction } from "../transactions/transaction-service";
import { computeSukiHealthScore } from "../../utils/suki-health-score";

const CUSTOMER_TX_LIMIT = 250;

/**
 * Denormalizes `customers.healthScore` / `healthScoreUpdatedAt` from ledger history
 * (same formula as morning-brief low-health sample). Call after transaction writes
 * that affect fulfillment, payment, or delivery status.
 */
export class CustomerHealthScoreService {
  /**
   * Recompute and persist health for one suki.
   * @param {string} businessId Workspace id.
   * @param {string} customerId Customer id.
   * @return {Promise<number | null>} New score, or null if customer missing.
   */
  static async recompute(
    businessId: string,
    customerId: string,
  ): Promise<number | null> {
    if (!businessId || !customerId) return null;

    try {
      const customerRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId);

      const snap = await customerRef.get();
      if (!snap.exists) return null;

      const customer = {
        id: customerId,
        businessId,
        ...snap.data(),
      } as Customer;

      const txSnap = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", customerId)
        .limit(CUSTOMER_TX_LIMIT)
        .get();

      const txs = txSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Transaction[];

      const score = computeSukiHealthScore(customer, txs, txs, new Date());

      await customerRef.update({
        healthScore: score,
        healthScoreUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return score;
    } catch (error) {
      logger.error("Failed to recompute customer healthScore", {
        businessId,
        customerId,
        error,
      });
      return null;
    }
  }

  /**
   * Fire-and-forget recompute (does not throw to callers).
   * @param {string} businessId Workspace id.
   * @param {string | undefined} customerId Customer id when present.
   */
  static scheduleRecompute(
    businessId: string,
    customerId: string | undefined,
  ): void {
    if (!customerId) return;
    void CustomerHealthScoreService.recompute(businessId, customerId).catch((error) => {
      logger.warn("scheduleRecompute healthScore failed", {
        businessId,
        customerId,
        error,
      });
    });
  }

  /**
   * Batch recompute for customers present in a ledger snapshot (nightly backfill).
   * @param {string} businessId Workspace id.
   * @param {Transaction[]} transactions Recent ledger rows.
   * @param {Object} [options] onlyMissing skips rows that already have healthScore.
   * @return {Promise<Object>} patched counts.
   */
  static async backfillBusiness(
    businessId: string,
    transactions: Transaction[],
    options: { onlyMissing?: boolean } = {},
  ): Promise<{ patched: number; scannedCustomers: number }> {
    const customerIds = new Set<string>();
    for (const tx of transactions) {
      if (tx.customerId) customerIds.add(tx.customerId);
    }

    let patched = 0;
    for (const customerId of customerIds) {
      if (options.onlyMissing) {
        const snap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("customers")
          .doc(customerId)
          .get();
        if (!snap.exists) continue;
        const existing = snap.data()?.healthScore;
        if (typeof existing === "number" && Number.isFinite(existing)) continue;
      }

      const score = await CustomerHealthScoreService.recompute(businessId, customerId);
      if (score != null) patched += 1;
    }

    return { patched, scannedCustomers: customerIds.size };
  }
}
