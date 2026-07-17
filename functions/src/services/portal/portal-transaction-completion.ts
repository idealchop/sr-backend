import { db, FieldValue } from "../../config/firebase-admin";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { derivePaymentFields } from "../transactions/payment-status";
import { ratingPatchFromPortalPayload } from "./portal-rating-updates";
import { portalPaymentConfirmedByRider } from "./portal-payment-utils";
import type { RawSubmissionPayload } from "./raw-submission-types";

export type ResolvedPortalCompletion = {
  txDocId: string;
  current: Transaction;
  submissionRef: string;
};

/**
 * Resolve the transaction and validate portal customer + delivery state.
 * @param {string} businessId
 * @param {string} portalCustomerId
 * @param {RawSubmissionPayload} payload
 * @return {Promise<ResolvedPortalCompletion>}
 */
export async function resolvePortalCompletionTransaction(
  businessId: string,
  portalCustomerId: string,
  payload: RawSubmissionPayload,
): Promise<ResolvedPortalCompletion> {
  const targetId =
    typeof payload.targetTransactionId === "string" ?
      payload.targetTransactionId.trim() :
      "";
  const refFromPayload =
    typeof payload.transactionReferenceId === "string" ?
      payload.transactionReferenceId.trim() :
      "";

  if (!targetId && !refFromPayload) {
    throw new Error("MISSING_TX_REFERENCE");
  }

  let txDocId: string | undefined;
  let current = targetId ?
    await TransactionService.getTransaction(businessId, targetId) :
    null;
  if (current && targetId) {
    txDocId = targetId;
  }

  if (!current && refFromPayload) {
    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .where("referenceId", "==", refFromPayload)
      .limit(1)
      .get();
    if (!snap.empty) {
      const d = snap.docs[0];
      txDocId = d.id;
      current = { id: d.id, ...d.data() } as Transaction;
    }
  }

  if (!current || !txDocId) {
    throw new Error("TX_NOT_FOUND");
  }
  if (
    portalCustomerId &&
    current.customerId &&
    portalCustomerId !== current.customerId
  ) {
    throw new Error("TX_FORBIDDEN");
  }
  const ready =
    current.deliveryStatus === "delivered" ||
    current.deliveryStatus === "collected" ||
    current.deliveryStatus === "completed";
  if (!ready) {
    throw new Error("TX_NOT_READY_FOR_COMPLETION");
  }

  const submissionRef = (current.referenceId || refFromPayload || "").trim();

  return { txDocId, current, submissionRef };
}

/**
 * Firestore patch for `transactions/{txDocId}` from portal completion payload + current tx.
 * @param {Transaction} current
 * @param {RawSubmissionPayload} payload
 * @return {Record<string, unknown>}
 */
export function buildPortalCompletionTransactionUpdates(
  current: Transaction,
  payload: RawSubmissionPayload,
): Record<string, unknown> {
  const pay = payload.payment;
  const cashConfirmedByRider = portalPaymentConfirmedByRider(pay);
  const deliveryProof = payload.deliveryProofUrl;
  const paymentProof = pay?.proofUrl;

  const completionNote =
    typeof payload.notes === "string" ? payload.notes.trim() : "";

  const payMeta = [
    pay?.reference && `Payment ref: ${String(pay.reference).trim()}`,
    pay?.date && `Payment date: ${String(pay.date).trim()}`,
    cashConfirmedByRider ? "Cash received by rider" : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const portalBlockParts = [payMeta, completionNote].filter(Boolean);
  const base = ((current.notes as string) || "").trim();
  let mergedNotes: string | undefined;
  if (portalBlockParts.length > 0) {
    const portalBlock = `[Portal completion] ${portalBlockParts.join("\n")}`;
    mergedNotes = base ? `${base}\n${portalBlock}` : portalBlock;
  } else {
    mergedNotes = base || undefined;
  }

  const declaredTotal = Number(current.totalAmount ?? 0);
  const prevPaid = Number(current.amountPaid ?? 0);
  const newPaid = pay?.amountPaid != null ? Number(pay.amountPaid) : prevPaid;
  const { balanceDue, paymentStatus } = derivePaymentFields(declaredTotal, newPaid);

  const updates: Record<string, unknown> = {
    deliveryStatus: "completed",
    attachmentUrl: paymentProof || deliveryProof || current.attachmentUrl,
    amountPaid: newPaid,
    balanceDue,
    paymentStatus,
    ...(mergedNotes !== undefined ? { notes: mergedNotes } : {}),
  };

  if (payload.signatureDataUrl) {
    updates.signatureUrl = payload.signatureDataUrl;
  }

  if (pay?.method) {
    updates.paymentMethod = pay.method;
  }

  if (deliveryProof) {
    updates.deliveryProofUrl = deliveryProof;
  }

  if (!current.deliveredAt) {
    updates.deliveredAt = FieldValue.serverTimestamp();
  }

  const paymentDelta = Math.max(0, newPaid - prevPaid);
  if (paymentDelta > 0) {
    const payList = [...(current.payments || [])];
    const payNotes =
      [
        pay?.reference && `Ref: ${String(pay.reference).trim()}`,
        pay?.date && `Paid: ${String(pay.date).trim()}`,
        cashConfirmedByRider ? "Cash: confirmed received by rider" : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Portal completion";

    let payDate: Date | ReturnType<typeof FieldValue.serverTimestamp> =
      FieldValue.serverTimestamp();
    if (pay?.date) {
      const d = new Date(String(pay.date));
      if (!Number.isNaN(d.getTime())) payDate = d;
    }

    payList.push({
      id: `pay-portal-${Date.now()}`,
      amount: paymentDelta,
      date: payDate,
      method:
        (pay?.method as string) || String(current.paymentMethod || "cash"),
      notes: payNotes,
    });
    updates.payments = payList;
  }

  const ratingPatch = ratingPatchFromPortalPayload(payload);
  for (const [k, v] of Object.entries(ratingPatch)) {
    (updates as Record<string, unknown>)[k] = v;
  }

  return updates;
}

export async function applyPortalCompletionTransactionPatch(
  businessId: string,
  txDocId: string,
  updates: Record<string, unknown>,
  userId: string,
): Promise<void> {
  await TransactionService.updateTransaction(
    businessId,
    txDocId,
    updates as any,
    userId,
  );
}
