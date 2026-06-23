import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { Customer, CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { maybeSendCustomerTxnNotification } from "./customer-transaction-notifier";
import type { RawSubmission, RawSubmissionPayload } from "./raw-submission-types";

/**
 * Merges portal profile fields from a completion submission onto the customer.
 * @param {string} businessId The business ID.
 * @param {string} customerId The customer ID.
 * @param {RawSubmissionPayload} payload Submission payload.
 */
export async function mergePortalProfileFromSubmission(
  businessId: string,
  customerId: string,
  payload: RawSubmissionPayload,
): Promise<void> {
  const profile = payload.profile || {};
  const updates: Record<string, unknown> = {};

  if (profile.email) updates.email = profile.email;
  if (profile.phone) updates.phone = profile.phone;
  if (profile.name) updates.name = profile.name;
  if (profile.portalEmailNotifications === true) {
    updates.portalEmailNotifications = true;
  }

  if (Object.keys(updates).length === 0) return;

  await CustomerService.updateCustomer(
    businessId,
    customerId,
    updates as Partial<Customer>,
  );
}

export function portalSubmissionRequestsEmailReceipt(
  submission: RawSubmission,
  customer: Customer | null,
): boolean {
  const profile = submission.payload?.profile || {};
  if (profile.portalEmailNotifications === true) return true;
  if (customer?.portalEmailNotifications === true) return true;
  return false;
}

/**
 * NT-28 / NT-33 — portal completion receipt via unified notifier (idempotent).
 * Covers pay-balance-only updates where delivery status does not change again.
 */
export async function maybeNotifyPortalCompletionReceipt(args: {
  businessId: string;
  submission: RawSubmission;
}): Promise<void> {
  const { businessId, submission } = args;
  const customerId = String(submission.customerId || "").trim();
  if (!customerId) return;

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return;

  const txDocId = await resolvePortalCompletionTxId(businessId, submission);
  if (!txDocId) return;

  const tx = await TransactionService.getTransaction(businessId, txDocId);
  if (!tx) {
    logger.warn("portal_completion_receipt_tx_missing", {
      businessId,
      txDocId,
      submissionId: submission.id,
    });
    return;
  }

  await maybeSendCustomerTxnNotification({
    businessId,
    transaction: { ...tx, id: txDocId },
    event: "completed",
  });
}

async function resolvePortalCompletionTxId(
  businessId: string,
  submission: RawSubmission,
): Promise<string | null> {
  const targetId = String(submission.payload?.targetTransactionId || "").trim();
  if (targetId) return targetId;

  const refFromPayload =
    typeof submission.payload?.transactionReferenceId === "string" ?
      submission.payload.transactionReferenceId.trim() :
      "";
  if (!refFromPayload) return null;

  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("referenceId", "==", refFromPayload)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
