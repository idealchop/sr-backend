import { db } from "../../config/firebase-admin";
import { QrCustomerService } from "../customers/qr-customer-service";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";

export type ResolvePortalTrackCustomerOptions = {
  customerId?: string;
  token?: string;
  targetTransactionId?: string;
  transactionReferenceId?: string;
  customerIdHint?: string;
};

async function customerIdFromSubmissionDoc(
  data: FirebaseFirestore.DocumentData | undefined,
): Promise<string> {
  return String(data?.customerId || "").trim();
}

/**
 * Resolves the suki for portal track quick actions (schedule, containers, payments).
 * Prefers a valid QR session; otherwise links via tracked transaction or submission.
 */
export async function resolvePortalTrackCustomerId(
  businessId: string,
  options: ResolvePortalTrackCustomerOptions,
): Promise<string> {
  const cid = String(options.customerId || "").trim();
  const tok = String(options.token || "").trim();
  if (cid && tok) {
    await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
    return cid;
  }

  const targetId = String(options.targetTransactionId || "").trim();
  const referenceId = String(options.transactionReferenceId || "").trim();
  const hint = String(options.customerIdHint || "").trim();

  if (targetId) {
    const tx = await TransactionService.getTransaction(businessId, targetId);
    const txCustomerId = String(tx?.customerId || "").trim();
    if (txCustomerId) return txCustomerId;

    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .doc(targetId)
      .get();
    if (subSnap.exists) {
      const subCustomerId = await customerIdFromSubmissionDoc(subSnap.data());
      if (subCustomerId) return subCustomerId;
    }
  }

  if (referenceId) {
    const txSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();
    if (!txSnap.empty) {
      const txCustomerId = String(txSnap.docs[0].data()?.customerId || "").trim();
      if (txCustomerId) return txCustomerId;
    }

    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();
    if (!subSnap.empty) {
      const subCustomerId = await customerIdFromSubmissionDoc(subSnap.docs[0].data());
      if (subCustomerId) return subCustomerId;
    }
  }

  if (hint) {
    const customer = await CustomerService.getCustomer(businessId, hint);
    if (customer?.id) return hint;
  }

  return "";
}
