import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { Customer } from "../customers/customer-service";
import type { Transaction } from "../transactions/transaction-service";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { getPortalCompletionReceiptEmail } from "../../utils/portal-completion-receipt-email-templates";
import {
  buildPortalCompletionReceiptPdf,
  formatBusinessAddressForPdf,
} from "./portal-completion-receipt-pdf";
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
 * NT-33 — PDF receipt email for completed ledger / portal transactions.
 */
export async function sendTransactionCompletionReceiptEmail(args: {
  businessId: string;
  transaction: Transaction;
  customer: Customer;
  recipientEmail: string;
}): Promise<boolean> {
  const { businessId, transaction, customer, recipientEmail } = args;
  if (!recipientEmail.includes("@")) return false;

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = (bizSnap.data() || {}) as Record<string, unknown>;

  const businessName = String(biz.name || biz.businessName || "Water station");
  const businessEmail = String(biz.email || "");
  const businessPhone = String(biz.phone || "");
  const businessAddress = formatBusinessAddressForPdf(biz);

  const customerName = customer.name || transaction.customerName || "Customer";
  const customerPhone = customer.phone || "";
  const customerAddress = customer.address || "";

  const completedAt = formatFirestorePhilippineDateTime(
    transaction.deliveredAt || transaction.updatedAt || new Date(),
  );

  const totalAmount = Number(transaction.totalAmount) || 0;
  const amountPaid = Number(transaction.amountPaid) || 0;
  const balanceDue = Number(transaction.balanceDue) || 0;

  const pdfBuffer = await buildPortalCompletionReceiptPdf({
    businessName,
    businessEmail,
    businessPhone,
    businessAddress,
    customerName,
    customerEmail: recipientEmail,
    customerPhone,
    customerAddress,
    referenceId: String(transaction.referenceId || ""),
    transactionType: formatTransactionTypeLabel(transaction.type),
    deliveryStatus: String(transaction.deliveryStatus || "completed"),
    paymentStatus: String(transaction.paymentStatus || "—"),
    paymentMethod: formatPaymentMethodLabel(transaction.paymentMethod),
    totalAmount,
    amountPaid,
    balanceDue,
    riderName: transaction.riderName,
    completedAt,
    lineItems: buildTransactionLineItems(transaction),
  });

  const money = (n: number) =>
    n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

  const template = getPortalCompletionReceiptEmail({
    customerName,
    businessName,
    referenceId: String(transaction.referenceId || "—"),
    completedAt,
    totalAmount: money(totalAmount),
    amountPaid: money(amountPaid),
    balanceDue: money(balanceDue),
    paymentMethod: formatPaymentMethodLabel(transaction.paymentMethod),
    paymentStatus: String(transaction.paymentStatus || "—"),
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: transaction completion receipt email", {
      to: recipientEmail,
      subject: template.subject,
      referenceId: transaction.referenceId,
    });
    return true;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: businessName.slice(0, 40),
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email: recipientEmail, name: customerName }];
  sendSmtpEmail.replyTo = businessEmail ?
    { email: businessEmail, name: businessName } :
    undefined;
  sendSmtpEmail.subject = template.subject;
  sendSmtpEmail.htmlContent = template.html;
  sendSmtpEmail.textContent = template.text;
  sendSmtpEmail.tags = [template.brevoTag, "staff_ledger_receipt"];
  sendSmtpEmail.attachment = [
    {
      name: `SmartRefill-Receipt-${String(transaction.referenceId || "order").replace(/[^\w-]+/g, "_")}.pdf`,
      content: pdfBuffer.toString("base64"),
    },
  ];

  await api.sendTransacEmail(sendSmtpEmail);
  logger.info("transaction_completion_receipt_email_sent", {
    businessId,
    referenceId: transaction.referenceId,
    to: recipientEmail,
  });
  return true;
}
