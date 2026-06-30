import { db, FieldValue, storage } from "../../config/firebase-admin";
import type { DocumentReference } from "firebase-admin/firestore";
import { formatFirestorePhilippineDateTime } from "../../utils/philippine-datetime";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import type { Transaction } from "../transactions/transaction-service";
import {
  buildTransactionCompletionReceiptArtifacts,
  sendTransactionCompletionReceiptEmail,
} from "../portal/transaction-completion-receipt-email";
import { getPortalCompletionReceiptMessengerText } from "../../utils/portal-completion-receipt-email-templates";
import {
  loadBusinessPaymentAccounts,
  resolveReceiptPaymentDisplay,
} from "../../utils/receipt-payment-display";
import { AlertDeliveryLogService } from "../notifications/alert-delivery-log-service";
import { claimCustomerNotifyChannel } from "../portal/customer-transaction-notifier";
import { readCommunityCustomerContact } from "./community-channel-contact";
import type { CommunitySourceChannel } from "./community-channel-contact";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import {
  sendMetaMessengerFileUrl,
  sendMetaMessengerText,
} from "./meta-messenger-send-service";

const REQUESTS_COLLECTION = "community_dispatch_requests";

function isValidEmail(value: string | undefined | null): value is string {
  const email = (value || "").trim();
  return !!email && email.includes("@");
}

async function findTransactionByReference(
  businessId: string,
  referenceId: string,
): Promise<(Transaction & { id: string }) | null> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("referenceId", "==", referenceId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as Transaction) };
}

function resolveCommunityReceiptEmail(
  parsed: CommunityOrderFields | undefined,
  customerEmail?: string,
): string | null {
  if (isValidEmail(parsed?.email)) return parsed.email.trim();
  if (isValidEmail(customerEmail)) return customerEmail.trim();
  return null;
}

async function uploadReceiptPdfForMessenger(params: {
  businessId: string;
  referenceId: string;
  pdfBuffer: Buffer;
}): Promise<string | null> {
  const bucketName =
    process.env.SMARTREFILL_FIREBASE_STORAGE_BUCKET?.trim() ||
    "smartrefill-singapore";
  const bucket = storage.bucket(bucketName);
  const safeRef = params.referenceId.replace(/[^\w-]+/g, "_") || "order";
  const objectPath =
    `community-messenger-receipts/${params.businessId}/${safeRef}-${Date.now()}.pdf`;
  const file = bucket.file(objectPath);

  try {
    await file.save(params.pdfBuffer, {
      contentType: "application/pdf",
      metadata: { cacheControl: "private, max-age=900" },
    });
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 30 * 60 * 1000,
    });
    return url;
  } catch (error) {
    logger.error("uploadReceiptPdfForMessenger failed", {
      businessId: params.businessId,
      referenceId: params.referenceId,
      error,
    });
    return null;
  }
}

export async function sendCommunityMessengerReceiptBundle(params: {
  psid: string;
  businessId: string;
  transaction: Transaction & { id: string };
  customer: NonNullable<Awaited<ReturnType<typeof CustomerService.getCustomer>>>;
}): Promise<{ ok: boolean; reason?: string }> {
  const artifacts = await buildTransactionCompletionReceiptArtifacts({
    businessId: params.businessId,
    transaction: params.transaction,
    customer: params.customer,
  });
  if (!artifacts) {
    return { ok: false, reason: "receipt_build_failed" };
  }

  const money = (n: number) =>
    n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
  const totalAmount = Number(params.transaction.totalAmount) || 0;
  const amountPaid = Number(params.transaction.amountPaid) || 0;
  const balanceDue = Number(params.transaction.balanceDue) || 0;
  const completedAt = formatFirestorePhilippineDateTime(
    params.transaction.deliveredAt || params.transaction.updatedAt || new Date(),
  );

  const paymentAccounts = await loadBusinessPaymentAccounts(params.businessId);
  const paymentDisplay = resolveReceiptPaymentDisplay(
    params.transaction,
    paymentAccounts,
  );

  const messengerReceiptText = getPortalCompletionReceiptMessengerText({
    customerName: artifacts.customerName,
    businessName: artifacts.businessName,
    referenceId: String(params.transaction.referenceId || "—"),
    completedAt,
    totalAmount: money(totalAmount),
    amountPaid: money(amountPaid),
    balanceDue: money(balanceDue),
    paymentMethod: paymentDisplay.paymentMethod,
    paymentStatus: String(params.transaction.paymentStatus || "—"),
    paymentReference: paymentDisplay.paymentReference,
  });

  const textResult = await sendMetaMessengerText(params.psid, messengerReceiptText);
  if (!textResult.ok) {
    return { ok: false, reason: textResult.reason };
  }

  const fileUrl = await uploadReceiptPdfForMessenger({
    businessId: params.businessId,
    referenceId: String(params.transaction.referenceId || ""),
    pdfBuffer: artifacts.pdfBuffer,
  });
  if (!fileUrl) {
    return { ok: false, reason: "receipt_upload_failed" };
  }

  const fileResult = await sendMetaMessengerFileUrl({
    recipientPsid: params.psid,
    fileUrl,
  });
  if (!fileResult.ok) {
    return { ok: false, reason: fileResult.reason };
  }

  logger.info("community_messenger_receipt_bundle_sent", {
    businessId: params.businessId,
    referenceId: params.transaction.referenceId,
  });

  return { ok: true };
}

export async function maybeSendCommunityReceiptEmail(params: {
  businessId: string;
  transaction: Transaction & { id: string };
  customer: NonNullable<Awaited<ReturnType<typeof CustomerService.getCustomer>>>;
  recipientEmail: string;
}): Promise<boolean> {
  const claimed = await claimCustomerNotifyChannel(
    params.businessId,
    params.transaction.id,
    "email",
    "completed",
  );
  if (!claimed) return false;

  try {
    const ok = await sendTransactionCompletionReceiptEmail({
      businessId: params.businessId,
      transaction: params.transaction,
      customer: params.customer,
      recipientEmail: params.recipientEmail,
    });
    await AlertDeliveryLogService.record(params.businessId, {
      channel: "email",
      category: "portal_completion_receipt",
      status: ok ? "sent" : "failed",
      audience: "customer",
      recipientCount: 1,
      successCount: ok ? 1 : 0,
      failureCount: ok ? 0 : 1,
      detail: {
        referenceId: params.transaction.referenceId,
        community: true,
        recipientEmail: params.recipientEmail,
      },
    });
    return ok;
  } catch (error) {
    logger.error("maybeSendCommunityReceiptEmail failed", {
      businessId: params.businessId,
      referenceId: params.transaction.referenceId,
      error,
    });
    return false;
  }
}

export async function loadCommunityDeliveryReceiptContext(params: {
  businessId: string;
  referenceId: string;
}): Promise<{
  requestDocRef: DocumentReference;
  parsed: CommunityOrderFields;
  psid: string;
  sourceChannel: CommunitySourceChannel;
  receiptEmail: string | null;
  transaction: (Transaction & { id: string }) | null;
  customer: Awaited<ReturnType<typeof CustomerService.getCustomer>>;
} | null> {
  const snap = await db
    .collection(REQUESTS_COLLECTION)
    .where("assignedBusinessId", "==", params.businessId)
    .where("submissionReferenceId", "==", params.referenceId)
    .where("status", "==", "accepted")
    .limit(1)
    .get();

  const doc = snap.docs[0];
  if (!doc) return null;

  const request = doc.data() as {
    sourceChannel?: CommunitySourceChannel;
    metaPsid?: string;
    whatsappWaId?: string;
    channelContactId?: string;
    parsed?: CommunityOrderFields;
    deliveryNotifiedAt?: unknown;
  };

  const contact = readCommunityCustomerContact({
    sourceChannel: request.sourceChannel ?? "community_messenger",
    metaPsid: request.metaPsid,
    whatsappWaId: request.whatsappWaId,
    channelContactId: request.channelContactId,
  });
  if (!contact || request.deliveryNotifiedAt) return null;

  const transaction = await findTransactionByReference(
    params.businessId,
    params.referenceId,
  );
  const customer =
    transaction?.customerId ?
      await CustomerService.getCustomer(params.businessId, transaction.customerId) :
      null;

  const receiptEmail = resolveCommunityReceiptEmail(
    request.parsed,
    customer?.email,
  );

  return {
    requestDocRef: doc.ref,
    parsed: request.parsed ?? {},
    psid: contact.contactId,
    sourceChannel: contact.sourceChannel,
    receiptEmail,
    transaction,
    customer,
  };
}

export async function markCommunityDeliveryNotified(
  requestDocRef: DocumentReference,
  extra?: Record<string, unknown>,
): Promise<void> {
  await requestDocRef.set(
    {
      deliveryNotifiedAt: FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true },
  );
}
