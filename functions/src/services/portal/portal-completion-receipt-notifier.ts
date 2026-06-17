import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { Customer, CustomerService } from "../customers/customer-service";
import { Transaction, TransactionService } from "../transactions/transaction-service";
import { brevo, getBrevoApi } from "../../utils/brevo";
import {
  getPortalCompletionReceiptEmail,
} from "../../utils/portal-completion-receipt-email-templates";
import {
  buildPortalCompletionReceiptPdf,
  formatBusinessAddressForPdf,
} from "./portal-completion-receipt-pdf";
import type { RawSubmission, RawSubmissionPayload } from "./raw-submission-types";
import { formatFirestorePhilippineDateTime } from "../../utils/philippine-datetime";

function formatPaymentMethodLabel(method: string | undefined): string {
  const m = (method || "").trim().toLowerCase();
  if (!m || m === "cash") return "Cash";
  return m.replace(/_/g, " ");
}

function formatTransactionTypeLabel(type: string | undefined): string {
  const t = (type || "").toLowerCase();
  if (t === "collection") return "Collection";
  if (t === "delivery") return "Delivery";
  if (t === "walkin") return "Walk-in";
  return type ? type.replace(/_/g, " ") : "Order";
}

function buildTransactionLineItems(tx: Transaction): string[] {
  const lines: string[] = [];
  for (const r of tx.waterRefills || []) {
    const qty = Number(r.quantity) || 0;
    const sub = Number(r.subtotal) || 0;
    const label = r.name || r.waterTypeId || "Water refill";
    lines.push(`${qty}× ${label} — PHP ${sub.toLocaleString("en-PH")}`);
  }
  for (const item of tx.items || []) {
    const qty = Number(item.quantity) || 0;
    const sub = Number(item.subtotal) || 0;
    const label = item.name || item.inventoryId || "Item";
    if (qty > 0) {
      lines.push(`${qty}× ${label} — PHP ${sub.toLocaleString("en-PH")}`);
    }
  }
  if (lines.length === 0) {
    lines.push("Order lines recorded on reference " + (tx.referenceId || "—"));
  }
  return lines;
}

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

function resolveReceiptEmail(
  submission: RawSubmission,
  customer: Customer | null,
): string {
  const profile = submission.payload?.profile || {};
  const fromProfile =
    typeof profile.email === "string" ? profile.email.trim() : "";
  const fromCustomer = customer?.email?.trim() || "";
  return fromProfile || fromCustomer;
}

/**
 * Sends a formal completion email with PDF receipt when the customer opted in.
 * Never throws — logs failures only.
 * @param {Object} args Input arguments.
 * @param {string} args.businessId The business ID.
 * @param {RawSubmission} args.submission The completed submission.
 * @return {Promise<void>}
 */
export async function maybeSendPortalCompletionReceiptEmail(args: {
  businessId: string;
  submission: RawSubmission;
}): Promise<void> {
  const { businessId, submission } = args;
  const customerId = String(submission.customerId || "").trim();
  if (!customerId) return;

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return;

  if (!portalSubmissionRequestsEmailReceipt(submission, customer)) {
    return;
  }

  const recipientEmail = resolveReceiptEmail(submission, customer);
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    logger.warn("portal_completion_receipt_skipped_invalid_email", {
      businessId,
      customerId,
      submissionId: submission.id,
    });
    return;
  }

  const txDocId = String(submission.payload.targetTransactionId || "").trim();
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

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = (bizSnap.data() || {}) as Record<string, unknown>;

  const businessName = String(biz.name || biz.businessName || "Water station");
  const businessEmail = String(biz.email || "");
  const businessPhone = String(biz.phone || "");
  const businessAddress = formatBusinessAddressForPdf(biz);

  const customerName =
    customer.name || tx.customerName || "Customer";
  const customerPhone = customer.phone || "";
  const customerAddress = customer.address || "";

  const completedAt = formatFirestorePhilippineDateTime(
    tx.deliveredAt || tx.updatedAt || new Date(),
  );

  const totalAmount = Number(tx.totalAmount) || 0;
  const amountPaid = Number(tx.amountPaid) || 0;
  const balanceDue = Number(tx.balanceDue) || 0;

  const pdfBuffer = await buildPortalCompletionReceiptPdf({
    businessName,
    businessEmail,
    businessPhone,
    businessAddress,
    customerName,
    customerEmail: recipientEmail,
    customerPhone,
    customerAddress,
    referenceId: String(tx.referenceId || submission.payload.transactionReferenceId || ""),
    transactionType: formatTransactionTypeLabel(tx.type),
    deliveryStatus: String(tx.deliveryStatus || "completed"),
    paymentStatus: String(tx.paymentStatus || "—"),
    paymentMethod: formatPaymentMethodLabel(tx.paymentMethod),
    totalAmount,
    amountPaid,
    balanceDue,
    riderName: tx.riderName,
    completedAt,
    lineItems: buildTransactionLineItems(tx),
  });

  const money = (n: number) =>
    n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

  const template = getPortalCompletionReceiptEmail({
    customerName,
    businessName,
    referenceId: String(tx.referenceId || "—"),
    completedAt,
    totalAmount: money(totalAmount),
    amountPaid: money(amountPaid),
    balanceDue: money(balanceDue),
    paymentMethod: formatPaymentMethodLabel(tx.paymentMethod),
    paymentStatus: String(tx.paymentStatus || "—"),
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: portal completion receipt email", {
      to: recipientEmail,
      subject: template.subject,
      referenceId: tx.referenceId,
    });
    return;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: businessName,
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email: recipientEmail, name: customerName }];
  sendSmtpEmail.replyTo = businessEmail ?
    { email: businessEmail, name: businessName } :
    undefined;
  sendSmtpEmail.subject = template.subject;
  sendSmtpEmail.htmlContent = template.html;
  sendSmtpEmail.textContent = template.text;
  sendSmtpEmail.tags = [template.brevoTag];
  sendSmtpEmail.attachment = [
    {
      name: `SmartRefill-Receipt-${String(tx.referenceId || "order").replace(/[^\w-]+/g, "_")}.pdf`,
      content: pdfBuffer.toString("base64"),
    },
  ];

  await api.sendTransacEmail(sendSmtpEmail);
  logger.info("portal_completion_receipt_email_sent", {
    businessId,
    customerId,
    referenceId: tx.referenceId,
    to: recipientEmail,
  });
}
