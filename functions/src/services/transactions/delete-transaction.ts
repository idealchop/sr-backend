import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import { AnalyticsMaterializerService } from "../analytics/analytics-materializer-service";
import { reverseTransactionEffects } from "./reverse-transaction-effects";
import { customerHasUnpaidReceivable } from "./customer-unpaid-receivable";
import type { Transaction } from "./transaction-types";

/**
 * Deletes a transaction and reverses inventory/possession side-effects.
 */
export async function deleteTransaction(
  businessId: string,
  transactionId: string,
  userId?: string,
  userName?: string,
): Promise<void> {
  const actor = buildAuditActorFields(userId, userName);
  try {
    const docRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .doc(transactionId);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    const transaction = snapshot.data() as Transaction;
    const customerId = transaction.customerId;

    // Revert inventory and possession
    await reverseTransactionEffects(
      businessId,
      transactionId,
      transaction,
      userId,
      userName,
    );

    // Finally delete the record
    await docRef.delete();

    // Log deletion
    await logAuditEvent(
      "TRANSACTION_DELETED",
      { businessId, referenceId: transaction.referenceId, ...actor },
      transaction,
      null,
      transactionId,
    );

    // Update customer hasBalance flag after deletion
    if (customerId) {
      try {
        const hasBalance = await customerHasUnpaidReceivable(
          businessId,
          customerId,
        );

        await db
          .collection("businesses")
          .doc(businessId)
          .collection("customers")
          .doc(customerId)
          .update({
            hasBalance,
            updatedAt: FieldValue.serverTimestamp(),
          });
      } catch (err) {
        // Log but don't fail the deletion if customer update fails (e.g. missing index)
        logger.warn(
          `Could not update hasBalance for customer ${customerId}`,
          err,
        );
      }
    }

    AnalyticsMaterializerService.scheduleMaterialize(businessId);
  } catch (error) {
    logger.error(`Error deleting transaction ${transactionId}`, error);
    throw error;
  }
}
