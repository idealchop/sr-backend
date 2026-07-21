import { db } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveBusinessEmailLogoUrl } from "../../utils/customer-email-branding";
import { buildCustomerPaymentUpdateEmail } from "../../utils/customer-payment-update-email-template";
import { buildCustomerTxnStatusEmail } from "../../utils/customer-txn-status-email-template";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { CustomerService } from "../customers/customer-service";
import {
  type CustomerTxnNotifyEvent,
} from "../portal/customer-transaction-notifier";
import {
  buildTransactionCompletionReceiptArtifacts,
  sendTransactionCompletionReceiptEmail,
} from "../portal/transaction-completion-receipt-email";
import type { Transaction } from "../transactions/transaction-service";
import {
  AlertDeliveryLogService,
  type AlertDeliveryLogRecord,
} from "./alert-delivery-log-service";

const EVENT_STATUS_LABEL: Record<CustomerTxnNotifyEvent, string> = {
  order_accepted: "Order accepted",
  in_transit: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
  payment_partial: "Partial payment received",
  payment_paid: "Payment received",
};

export class AlertDeliveryResendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AlertDeliveryResendError";
  }
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

function buildTrackUrl(
  businessId: string,
  customerId: string,
  referenceId: string,
): string {
  const base = resolveAppBaseUrlForEmail();
  const params = new URLSearchParams({ b: businessId, ref: referenceId });
  if (customerId) params.set("c", customerId);
  return `${base}/order?${params.toString()}`;
}

function formatCustomerMoney(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

async function sendBrevoCustomerEmail(args: {
  businessName: string;
  businessEmail?: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  html: string;
  text: string;
  tags: string[];
}): Promise<boolean> {
  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: alert delivery resend email", {
      to: args.recipientEmail,
      subject: args.subject,
      tags: args.tags,
    });
    return true;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: args.businessName.slice(0, 60),
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email: args.recipientEmail, name: args.recipientName }];
  if (args.businessEmail) {
    sendSmtpEmail.replyTo = {
      email: args.businessEmail,
      name: args.businessName,
    };
  }
  sendSmtpEmail.subject = args.subject;
  sendSmtpEmail.htmlContent = args.html;
  sendSmtpEmail.textContent = args.text;
  sendSmtpEmail.tags = args.tags;
  await api.sendTransacEmail(sendSmtpEmail);
  return true;
}

export function canResendAlertDeliveryLog(entry: AlertDeliveryLogRecord): boolean {
  if (entry.status !== "failed") return false;
  if (entry.channel !== "email") return false;
  if (!String(entry.detail?.referenceId || "").trim()) return false;
  return (
    entry.category === "portal_completion_receipt" ||
    entry.category === "customer_txn_status" ||
    entry.category === "customer_payment_update" ||
    typeof entry.detail?.event === "string"
  );
}

/** Owner can preview reconstructed HTML for customer emails tied to a transaction. */
export function canPreviewAlertDeliveryLog(entry: AlertDeliveryLogRecord): boolean {
  if (entry.channel !== "email") return false;
  if (!String(entry.detail?.referenceId || "").trim()) return false;
  return (
    entry.category === "portal_completion_receipt" ||
    entry.category === "customer_txn_status" ||
    entry.category === "customer_payment_update" ||
    typeof entry.detail?.event === "string"
  );
}

export type AlertDeliveryEmailPreview = {
  subject: string;
  html: string;
  text: string;
  category: string;
  referenceId: string;
  toEmail: string;
};

/**
 * Rebuild customer email HTML/text from the linked transaction (does not send).
 */
export async function previewAlertDeliveryLogEntry(
  businessId: string,
  logId: string,
): Promise<AlertDeliveryEmailPreview> {
  const entry = await AlertDeliveryLogService.getById(businessId, logId);
  if (!entry) {
    throw new AlertDeliveryResendError("Delivery log entry not found", "NOT_FOUND", 404);
  }
  if (!canPreviewAlertDeliveryLog(entry)) {
    throw new AlertDeliveryResendError(
      "This delivery cannot be previewed",
      "PREVIEW_NOT_SUPPORTED",
    );
  }

  const referenceId = String(entry.detail?.referenceId || "").trim();
  const tx = await findTransactionByReference(businessId, referenceId);
  if (!tx?.customerId) {
    throw new AlertDeliveryResendError(
      "Linked transaction not found",
      "TX_NOT_FOUND",
      404,
    );
  }

  const customer = await CustomerService.getCustomer(businessId, tx.customerId);
  if (!customer) {
    throw new AlertDeliveryResendError("Customer not found", "CUSTOMER_NOT_FOUND", 404);
  }

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = bizSnap.data() ?? {};
  const businessName = String(biz.name || "Your water station");
  const businessLogoUrl = resolveBusinessEmailLogoUrl(biz.logo);
  const trackUrl = buildTrackUrl(businessId, tx.customerId, referenceId);
  const customerName = customer.name || tx.customerName || "Customer";
  const toEmail = String(
    entry.detail?.toEmail || customer.email || "",
  ).trim();

  if (
    entry.category === "portal_completion_receipt" ||
    entry.detail?.event === "completed"
  ) {
    const artifacts = await buildTransactionCompletionReceiptArtifacts({
      businessId,
      transaction: tx,
      customer,
      recipientEmail: toEmail || customer.email,
    });
    if (!artifacts) {
      throw new AlertDeliveryResendError(
        "Could not build receipt preview",
        "PREVIEW_BUILD_FAILED",
      );
    }
    return {
      subject: artifacts.template.subject,
      html: artifacts.template.html,
      text: artifacts.template.text,
      category: "portal_completion_receipt",
      referenceId,
      toEmail: toEmail || String(customer.email || ""),
    };
  }

  if (entry.category === "customer_payment_update") {
    const total = Number(tx.totalAmount ?? 0);
    const paid = Number(tx.amountPaid ?? 0);
    const balance = Number(tx.balanceDue ?? Math.max(0, total - paid));
    const paymentStatus = String(tx.paymentStatus || "").toLowerCase();
    const kind = paymentStatus === "paid" ? "paid" : "partial";
    const statusLabel =
      kind === "paid" ? "Payment received" : "Partial payment received";
    const detailLine =
      kind === "paid" ?
        `Fully paid na ang order mo sa ${businessName}. Salamat sa payment!` :
        `Nakatanggap kami ng partial payment. Natitirang balance: ${formatCustomerMoney(balance)}.`;
    const tpl = buildCustomerPaymentUpdateEmail({
      customerName,
      businessName,
      businessLogoUrl,
      referenceId,
      trackUrl,
      statusLabel,
      totalAmount: formatCustomerMoney(total),
      amountPaid: formatCustomerMoney(paid),
      balanceDue: formatCustomerMoney(balance),
      detailLine,
    });
    return {
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      category: tpl.brevoTag,
      referenceId,
      toEmail: toEmail || String(customer.email || ""),
    };
  }

  const event = String(entry.detail?.event || "order_accepted") as CustomerTxnNotifyEvent;
  const statusLabel = EVENT_STATUS_LABEL[event] ?? "Order update";
  const detailLine =
    event === "in_transit" ?
      "Ang order mo ay on the way na." :
      event === "cancelled" ?
        "Na-cancel ang order na ito. Mag-message sa station kung may tanong." :
        "Tinanggap na ng station ang order mo at iaasikaso na.";
  const tpl = buildCustomerTxnStatusEmail({
    customerName,
    businessName,
    businessLogoUrl,
    referenceId,
    statusLabel,
    trackUrl,
    detailLine,
  });
  return {
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    category: tpl.brevoTag,
    referenceId,
    toEmail: toEmail || String(customer.email || ""),
  };
}

/** Re-send a failed customer email logged in alert_delivery_log. */
export async function resendAlertDeliveryLogEntry(
  businessId: string,
  logId: string,
): Promise<{ sent: boolean }> {
  const entry = await AlertDeliveryLogService.getById(businessId, logId);
  if (!entry) {
    throw new AlertDeliveryResendError("Delivery log entry not found", "NOT_FOUND", 404);
  }
  if (!canResendAlertDeliveryLog(entry)) {
    throw new AlertDeliveryResendError(
      "This delivery cannot be resent from the log",
      "RESEND_NOT_SUPPORTED",
    );
  }

  const referenceId = String(entry.detail?.referenceId || "").trim();
  const tx = await findTransactionByReference(businessId, referenceId);
  if (!tx?.customerId) {
    throw new AlertDeliveryResendError(
      "Linked transaction not found",
      "TX_NOT_FOUND",
      404,
    );
  }

  const customer = await CustomerService.getCustomer(businessId, tx.customerId);
  if (!customer?.email?.includes("@")) {
    throw new AlertDeliveryResendError(
      "Customer has no email on file",
      "NO_CUSTOMER_EMAIL",
    );
  }

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = bizSnap.data() ?? {};
  const businessName = String(biz.name || "Your water station");
  const businessEmail = String(biz.email || "");
  const businessLogoUrl = resolveBusinessEmailLogoUrl(biz.logo);
  const trackUrl = buildTrackUrl(businessId, tx.customerId, referenceId);
  const customerName = customer.name || tx.customerName || "Customer";

  let ok = false;
  let category = entry.category;
  let detail: Record<string, unknown> = {
    referenceId,
    resentFromLogId: logId,
  };

  if (
    entry.category === "portal_completion_receipt" ||
    entry.detail?.event === "completed"
  ) {
    ok = await sendTransactionCompletionReceiptEmail({
      businessId,
      transaction: tx,
      customer,
      recipientEmail: customer.email,
    });
    category = "portal_completion_receipt";
    detail = { ...detail, event: "completed" };
  } else if (entry.category === "customer_payment_update") {
    const total = Number(tx.totalAmount ?? 0);
    const paid = Number(tx.amountPaid ?? 0);
    const balance = Number(tx.balanceDue ?? Math.max(0, total - paid));
    const paymentStatus = String(tx.paymentStatus || "").toLowerCase();
    const kind = paymentStatus === "paid" ? "paid" : "partial";
    const statusLabel =
      kind === "paid" ? "Payment received" : "Partial payment received";
    const detailLine =
      kind === "paid" ?
        `Fully paid na ang order mo sa ${businessName}. Salamat sa payment!` :
        `Nakatanggap kami ng partial payment. Natitirang balance: ${formatCustomerMoney(balance)}.`;
    const tpl = buildCustomerPaymentUpdateEmail({
      customerName,
      businessName,
      businessLogoUrl,
      referenceId,
      trackUrl,
      statusLabel,
      totalAmount: formatCustomerMoney(total),
      amountPaid: formatCustomerMoney(paid),
      balanceDue: formatCustomerMoney(balance),
      detailLine,
    });
    ok = await sendBrevoCustomerEmail({
      businessName,
      businessEmail,
      recipientEmail: customer.email,
      recipientName: customerName,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      tags: [tpl.brevoTag, "resend"],
    });
    category = tpl.brevoTag;
    detail = {
      ...detail,
      eventKey: entry.detail?.eventKey ?? `payment_${kind}`,
    };
  } else {
    const event = String(entry.detail?.event || "order_accepted") as CustomerTxnNotifyEvent;
    const statusLabel = EVENT_STATUS_LABEL[event] ?? "Order update";
    const detailLine =
      event === "in_transit" ?
        "Ang order mo ay on the way na." :
        event === "cancelled" ?
          "Na-cancel ang order na ito. Mag-message sa station kung may tanong." :
          "Tinanggap na ng station ang order mo at iaasikaso na.";
    const tpl = buildCustomerTxnStatusEmail({
      customerName,
      businessName,
      businessLogoUrl,
      referenceId,
      statusLabel,
      trackUrl,
      detailLine,
    });
    ok = await sendBrevoCustomerEmail({
      businessName,
      businessEmail,
      recipientEmail: customer.email,
      recipientName: customerName,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      tags: [tpl.brevoTag, `txn_${event}`, "resend"],
    });
    category = tpl.brevoTag;
    detail = { ...detail, event };
  }

  await AlertDeliveryLogService.record(businessId, {
    channel: "email",
    category,
    status: ok ? "sent" : "failed",
    audience: "customer",
    recipientCount: 1,
    successCount: ok ? 1 : 0,
    failureCount: ok ? 0 : 1,
    detail,
  });

  return { sent: ok };
}
