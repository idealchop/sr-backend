import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import { CustomerLastFulfilledService } from
  "../services/customers/customer-last-fulfilled-service";
import { TransactionService } from "../services/transactions/transaction-service";

const BUSINESSES_PER_RUN = 25;
const TX_LIMIT_PER_BUSINESS = 2000;

/**
 * Nightly safety net: patches `customers.lastFulfilledAt` from ledger history when missing
 * or older than the latest fulfilled transaction.
 */
export const backfillCustomerLastFulfilled = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const businessSnap = await db
      .collection("businesses")
      .orderBy("updatedAt", "desc")
      .limit(BUSINESSES_PER_RUN)
      .get();

    let totalPatched = 0;
    let businessesProcessed = 0;

    for (const businessDoc of businessSnap.docs) {
      const businessId = businessDoc.id;
      try {
        const transactions = await TransactionService.getTransactionsByBusiness(
          businessId,
          { limit: TX_LIMIT_PER_BUSINESS },
        );
        const result = await CustomerLastFulfilledService.backfillBusiness(
          businessId,
          transactions,
          { onlyMissing: true },
        );
        totalPatched += result.patched;
        businessesProcessed += 1;
      } catch (error) {
        logger.error("backfillCustomerLastFulfilled business failed", {
          businessId,
          error,
        });
      }
    }

    logger.info("backfillCustomerLastFulfilled complete", {
      businessesProcessed,
      totalPatched,
    });
  },
);
