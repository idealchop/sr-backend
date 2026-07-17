import type { DocumentReference } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import { sendAdvancePaymentReceiptEmail } from "../notifications/owner-email-digest-services";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { derivePaymentFields } from "../transactions/payment-status";
import {
  normalizePortalStarRating,
  ratingPatchFromPortalPayload,
} from "./portal-rating-updates";
import { portalPaymentConfirmedByRider } from "./portal-payment-utils";
import type { RawSubmission, RawSubmissionPayload } from "./raw-submission-types";

export type ResolvedPortalBalancePayment = {
  txDocId: string;
  current: Transaction;
};

/**
 * Resolve a delivery transaction for an additional portal payment (balance / partial).
 * Does not require Delivered — customer may remit before or after completion.
 * @param {string} businessId
 * @param {string} portalCustomerId
 * @param {RawSubmissionPayload} payload
 * @return {Promise<ResolvedPortalBalancePayment>}
 */
export async function resolvePortalBalancePaymentTransaction(
  businessId: string,
  portalCustomerId: string,
  payload: RawSubmissionPayload,
): Promise<ResolvedPortalBalancePayment> {
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
  const txType = String(current.type || "").toLowerCase();
  if (txType !== "delivery") {
    throw new Error("TX_NOT_ELIGIBLE_FOR_PORTAL_PAYMENT");
  }
  const ps = String(current.paymentStatus || "unpaid").toLowerCase();
  if (ps === "paid" || ps === "n/a") {
    throw new Error("TX_ALREADY_PAID");
  }

  return { txDocId, current };
}

/**
 * Apply an incremental payment from the portal without changing fulfillment fields.
 * @param {Transaction} current
 * @param {RawSubmissionPayload} payload
 * @return {Record<string, unknown>}
 */
export function buildPortalBalancePaymentUpdates(
  current: Transaction,
  payload: RawSubmissionPayload,
): Record<string, unknown> {
  const pay = payload.payment;
  const cashConfirmedByRider = portalPaymentConfirmedByRider(pay);
  const incremental = Math.max(0, Number(pay?.amountPaid ?? 0));
  const declaredTotal = Number(current.totalAmount ?? 0);
  const prevPaid = Number(current.amountPaid ?? 0);
  const newPaid = Math.min(declaredTotal, prevPaid + incremental);
  const { balanceDue, paymentStatus } = derivePaymentFields(declaredTotal, newPaid);

  const paymentProof = pay?.proofUrl;
  const completionNote =
    typeof payload.notes === "string" ? payload.notes.trim() : "";
  const svcStar = normalizePortalStarRating(
    payload.serviceRating ?? payload.rating,
  );
  const riderStar = normalizePortalStarRating(payload.riderRating);
  const ratingLine = [
    svcStar != null ? `Service: ${svcStar}/5` : "",
    riderStar != null ? `Rider: ${riderStar}/5` : "",
    payload.feedback ? String(payload.feedback).trim().slice(0, 200) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const payMeta = [
    pay?.reference && `Payment ref: ${String(pay.reference).trim()}`,
    pay?.date && `Payment date: ${String(pay.date).trim()}`,
    cashConfirmedByRider ? "Cash: confirmed received by rider" : "",
    ratingLine,
  ]
    .filter(Boolean)
    .join(" | ");

  const portalBlock = `[Portal ${
    payload.portalPaymentPhase === "advance" ? "advance payment" : "balance payment"
  }] ${payMeta}${
    completionNote ? ` | ${completionNote}` : ""
  }`.trim();
  const base = ((current.notes as string) || "").trim();
  const mergedNotes = base ? `${base}\n${portalBlock}` : portalBlock;

  const updates: Record<string, unknown> = {
    amountPaid: newPaid,
    balanceDue,
    paymentStatus,
    notes: mergedNotes,
  };

  const ratingPatch = ratingPatchFromPortalPayload(payload);
  for (const [k, v] of Object.entries(ratingPatch)) {
    updates[k] = v;
  }

  if (pay?.method) {
    updates.paymentMethod = pay.method;
  }

  if (paymentProof) {
    updates.attachmentUrl = paymentProof;
  }

  const entryAmount = Math.max(0, newPaid - prevPaid);
  if (entryAmount > 0) {
    const payList = [...(current.payments || [])];
    const payNotes =
      [
        pay?.reference && `Ref: ${String(pay.reference).trim()}`,
        pay?.date && `Paid: ${String(pay.date).trim()}`,
        cashConfirmedByRider ? "Cash: confirmed by rider" : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
      (payload.portalPaymentPhase === "advance" ?
        "Portal advance payment" :
        "Portal balance payment");

    let payDate: Date | ReturnType<typeof FieldValue.serverTimestamp> =
      FieldValue.serverTimestamp();
    if (pay?.date) {
      const d = new Date(String(pay.date));
      if (!Number.isNaN(d.getTime())) payDate = d;
    }

    payList.push({
      id: `pay-portal-bal-${Date.now()}`,
      amount: entryAmount,
      date: payDate,
      method:
        (pay?.method as string) || String(current.paymentMethod || "cash"),
      notes: payNotes,
    });
    updates.payments = payList;
  }

  return updates;
}

/** NT-30 — email suki when portal advance payment is recorded. */
export async function maybeSendAdvancePaymentReceiptEmail(
  businessId: string,
  submission: RawSubmission,
  before: Transaction,
  after: Transaction,
): Promise<void> {
  if (submission.payload.portalPaymentPhase !== "advance") return;

  const prevPaid = Number(before.amountPaid) || 0;
  const newPaid = Number(after.amountPaid) || 0;
  const delta = Math.max(0, newPaid - prevPaid);
  if (delta <= 0) return;

  const customerId = submission.customerId || after.customerId;
  if (!customerId) return;

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer?.email?.includes("@")) return;
  if (customer.portalEmailNotifications === false) return;

  const businessDoc = await db.collection("businesses").doc(businessId).get();
  const businessName = String(businessDoc.data()?.name || "Your water station");
  const referenceId = String(after.referenceId || "").trim();
  if (!referenceId) return;

  const params = new URLSearchParams({ b: businessId, ref: referenceId });
  params.set("c", customerId);

  await sendAdvancePaymentReceiptEmail({
    businessId,
    customerEmail: customer.email,
    customerName: customer.name || "Customer",
    businessName,
    amount: delta,
    referenceId,
    trackUrl: `${resolveAppBaseUrlForEmail()}/order?${params.toString()}`,
  });
}

/**
 * Deletes all raw_submissions tied to a canonical transaction reference (TX-…).
 * Used after payment is fully settled and delivery is complete.
 * @param {string} businessId
 * @param {string} transactionReferenceId
 * @param {string[]} excludeIds
 * @return {Promise<void>}
 */
export async function deleteRawSubmissionsLinkedToTransactionRef(
  businessId: string,
  transactionReferenceId: string,
  excludeIds: string[] = [],
): Promise<void> {
  const ref = transactionReferenceId.trim();
  if (!ref) return;

  const exclude = new Set(excludeIds.filter(Boolean));

  const col = db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions");
  const [byPayloadRef, byTopRef] = await Promise.all([
    col.where("payload.transactionReferenceId", "==", ref).get(),
    col.where("referenceId", "==", ref).get(),
  ]);

  const unique = new Map<string, DocumentReference>();
  for (const d of byPayloadRef.docs) {
    if (!exclude.has(d.id)) unique.set(d.id, d.ref);
  }
  for (const d of byTopRef.docs) {
    if (!exclude.has(d.id)) unique.set(d.id, d.ref);
  }

  const refs = [...unique.values()];
  const chunk = 400;
  for (let i = 0; i < refs.length; i += chunk) {
    const batch = db.batch();
    for (const r of refs.slice(i, i + chunk)) {
      batch.delete(r);
    }
    await batch.commit();
  }

  logger.info("raw_submissions deleted for transaction ref", {
    businessId,
    transactionReferenceId: ref,
    count: refs.length,
  });
}

export async function maybeDeleteRawSubmissionsAfterPaidComplete(
  businessId: string,
  txDocId: string,
  fallbackReferenceId: string,
  excludeSubmissionId?: string,
): Promise<void> {
  const fresh = await TransactionService.getTransaction(businessId, txDocId);
  if (!fresh) return;
  const paid = String(fresh.paymentStatus || "").toLowerCase() === "paid";
  const complete =
    String(fresh.deliveryStatus || "").toLowerCase() === "completed";
  if (!paid || !complete) return;
  const txRef =
    String(fresh.referenceId || "").trim() ||
    String(fallbackReferenceId || "").trim();
  if (txRef) {
    await deleteRawSubmissionsLinkedToTransactionRef(
      businessId,
      txRef,
      excludeSubmissionId ? [excludeSubmissionId] : [],
    );
  }
}
