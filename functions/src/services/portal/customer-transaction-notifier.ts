import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import {
  type Transaction,
} from "../transactions/transaction-service";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { buildCustomerTxnStatusEmail } from "../../utils/customer-txn-status-email-template";
import { buildCustomerPaymentUpdateEmail } from "../../utils/customer-payment-update-email-template";
import { resolveBusinessEmailLogoUrl } from "../../utils/customer-email-branding";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { sendTransactionCompletionReceiptEmail } from "./transaction-completion-receipt-email";
import { maybeSendCustomerTxnSms } from "./customer-sms-notifier";
import { maybeSendCustomerTxnWebPush } from "./customer-web-push-notifier";
import { AlertDeliveryLogService } from "../notifications/alert-delivery-log-service";

export type CustomerTxnNotifyEvent =
  | "order_accepted"
  | "in_transit"
  | "completed"
  | "cancelled"
  | "payment_partial"
  | "payment_paid";

/** Idempotency keys stored on transaction.customerNotifiedEvents (email/sms/push). */
export type CustomerNotifyEventKey = CustomerTxnNotifyEvent | `payment_partial_${number}`;

const EVENT_STATUS_LABEL: Record<CustomerTxnNotifyEvent, string> = {
  order_accepted: "Order accepted",
  in_transit: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
  payment_partial: "Partial payment received",
  payment_paid: "Payment received",
};

type NotifyChannel = "email" | "sms" | "push";

type ChannelNotifiedMap = Partial<Record<NotifyChannel, string[]>>;

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

function normalizeDeliveryStatus(status: string | undefined): string {
  return (status || "").toLowerCase().replace(/-/g, "_");
}

export function mapDeliveryStatusToEvent(
  before: string | undefined,
  after: string | undefined,
): CustomerTxnNotifyEvent | null {
  const prev = normalizeDeliveryStatus(before);
  const next = normalizeDeliveryStatus(after);
  if (next === "cancelled" && prev !== "cancelled") return "cancelled";
  if (
    (next === "completed" || next === "delivered" || next === "collected") &&
    prev !== "completed" &&
    prev !== "delivered" &&
    prev !== "collected"
  ) {
    return "completed";
  }
  if (
    (next === "in_transit" || next === "out_for_delivery") &&
    prev !== "in_transit" &&
    prev !== "out_for_delivery"
  ) {
    return "in_transit";
  }
  if (
    (next === "accepted" || next === "confirmed" || next === "processing" || next === "placed") &&
    (prev === "pending" || prev === "new" || !prev)
  ) {
    return "order_accepted";
  }
  return null;
}

function normalizePaymentStatus(status: string | undefined): string {
  return (status || "unpaid").toLowerCase();
}

function formatCustomerMoney(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/**
 * Maps a payment ledger change to a customer notify key (partial top-ups included).
 */
export function mapPaymentUpdateNotifyKey(args: {
  before: Transaction | null;
  after: Transaction;
}): { eventKey: CustomerNotifyEventKey; kind: "partial" | "paid" } | null {
  const beforePs = normalizePaymentStatus(args.before?.paymentStatus);
  const afterPs = normalizePaymentStatus(args.after.paymentStatus);
  if (afterPs === "n/a") return null;

  const prevPaid = Number(args.before?.amountPaid ?? 0);
  const newPaid = Number(args.after.amountPaid ?? 0);

  if (afterPs === "paid" && beforePs !== "paid") {
    return { eventKey: "payment_paid", kind: "paid" };
  }

  if (afterPs === "partial") {
    if (beforePs !== "partial" && newPaid > 0) {
      return { eventKey: "payment_partial", kind: "partial" };
    }
    if (beforePs === "partial" && newPaid > prevPaid) {
      return {
        eventKey: `payment_partial_${Math.round(newPaid * 100)}`,
        kind: "partial",
      };
    }
  }

  return null;
}

function deliveryStatusLabel(status: string | undefined): string {
  const s = normalizeDeliveryStatus(status);
  if (s === "in_transit" || s === "out_for_delivery") return "on the way";
  if (s === "completed" || s === "delivered" || s === "collected") return "delivered";
  if (s === "cancelled") return "cancelled";
  return status || "updated";
}

function customerWantsEmail(customer: {
  portalEmailNotifications?: boolean;
  portalStatusEmailsEnabled?: boolean;
}): boolean {
  if (customer.portalEmailNotifications === false) return false;
  if (customer.portalStatusEmailsEnabled === false) return false;
  return true;
}

async function readChannelNotified(
  businessId: string,
  txId: string,
): Promise<ChannelNotifiedMap> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(txId)
    .get();
  const data = snap.data() ?? {};
  const map = (data.customerNotifiedEvents ?? {}) as ChannelNotifiedMap;
  const legacyEmail = (data.emailNotifiedEvents ?? []) as string[];
  return {
    email: [...(map.email ?? []), ...legacyEmail.filter((e) => !(map.email ?? []).includes(e))],
    sms: map.sms ?? [],
    push: map.push ?? [],
  };
}

/** Per-channel idempotency (NT-34). Returns true when this channel has not sent for event yet. */
async function markChannelNotified(
  businessId: string,
  txId: string,
  channel: NotifyChannel,
  event: CustomerNotifyEventKey,
): Promise<boolean> {
  const current = await readChannelNotified(businessId, txId);
  const list = current[channel] ?? [];
  if (list.includes(event)) return false;

  const ref = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(txId);

  const updates: Record<string, unknown> = {
    [`customerNotifiedEvents.${channel}`]: FieldValue.arrayUnion(event),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (channel === "email") {
    updates.emailNotifiedEvents = FieldValue.arrayUnion(event);
  }

  await ref.update(updates);
  return true;
}

/**
 * NT-32 / NT-33 / NT-34 — unified customer notifications on ledger status changes.
 */
export async function maybeSendCustomerTxnNotification(args: {
  businessId: string;
  transaction: Transaction & { id?: string };
  beforeStatus?: string;
  event?: CustomerTxnNotifyEvent;
}): Promise<{ sent: boolean }> {
  const txId = args.transaction.id;
  if (!txId) return { sent: false };
  return maybeNotifyCustomerOnTransactionStatus({
    businessId: args.businessId,
    txId,
    transaction: args.transaction,
    beforeStatus: args.beforeStatus,
    event: args.event,
  });
}

export async function maybeNotifyCustomerOnTransactionStatus(args: {
  businessId: string;
  txId: string;
  transaction: Transaction;
  beforeStatus?: string;
  event?: CustomerTxnNotifyEvent;
}): Promise<{ sent: boolean }> {
  const { businessId, txId, transaction, beforeStatus } = args;
  const customerId = transaction.customerId;
  const referenceId = String(transaction.referenceId || "");
  if (!customerId || !referenceId) return { sent: false };

  const event =
    args.event ??
    mapDeliveryStatusToEvent(beforeStatus, transaction.deliveryStatus);
  if (!event) return { sent: false };

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return { sent: false };

  const shouldSendEmail = customerWantsEmail(customer);
  const shouldSendSms = customer.portalSmsOptIn === true;
  const shouldSendWebPush = customer.portalWebPushEnabled === true;
  if (!shouldSendEmail && !shouldSendSms && !shouldSendWebPush) {
    return { sent: false };
  }

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = bizSnap.data() ?? {};
  const businessName = String(biz.name || "Your water station");
  const businessLogoUrl = resolveBusinessEmailLogoUrl(biz.logo);
  const trackUrl = buildTrackUrl(businessId, customerId, referenceId);
  const statusLabel = EVENT_STATUS_LABEL[event];
  const detailLine =
    event === "in_transit" ?
      `Ang order mo ay ${deliveryStatusLabel(transaction.deliveryStatus)} na.` :
      event === "completed" ?
        "Salamat sa pag-order! Sana satisfied ka sa serbisyo namin." :
        event === "cancelled" ?
          "Na-cancel ang order na ito. Mag-message sa station kung may tanong." :
          "Tinanggap na ng station ang order mo at iaasikaso na.";

  let sent = false;

  if (shouldSendEmail && customer.email?.includes("@")) {
    const firstEmail = await markChannelNotified(businessId, txId, "email", event);
    if (firstEmail) {
      try {
        if (event === "completed") {
          const ok = await sendTransactionCompletionReceiptEmail({
            businessId,
            transaction,
            customer,
            recipientEmail: customer.email,
          });
          if (ok) sent = true;
          await AlertDeliveryLogService.record(businessId, {
            channel: "email",
            category: "portal_completion_receipt",
            status: ok ? "sent" : "failed",
            audience: "customer",
            recipientCount: 1,
            successCount: ok ? 1 : 0,
            failureCount: ok ? 0 : 1,
            detail: { event, referenceId },
          });
        } else {
          const tpl = buildCustomerTxnStatusEmail({
            customerName: customer.name || transaction.customerName || "Customer",
            businessName,
            businessLogoUrl,
            referenceId,
            statusLabel,
            trackUrl,
            detailLine,
          });

          if (process.env.FUNCTIONS_EMULATOR) {
            logger.info("EMULATOR: customer txn status email", {
              businessId,
              referenceId,
              event,
            });
            sent = true;
          } else {
            const api = getBrevoApi();
            const sendSmtpEmail = new brevo.SendSmtpEmail();
            sendSmtpEmail.sender = {
              name: businessName.slice(0, 60),
              email: "no-reply@smartrefill.io",
            };
            sendSmtpEmail.to = [
              {
                email: customer.email,
                name: customer.name || "Customer",
              },
            ];
            sendSmtpEmail.subject = tpl.subject;
            sendSmtpEmail.htmlContent = tpl.html;
            sendSmtpEmail.textContent = tpl.text;
            sendSmtpEmail.tags = [tpl.brevoTag, `txn_${event}`];
            await api.sendTransacEmail(sendSmtpEmail);
            sent = true;
            await AlertDeliveryLogService.record(businessId, {
              channel: "email",
              category: tpl.brevoTag,
              status: "sent",
              audience: "customer",
              recipientCount: 1,
              successCount: 1,
              detail: { event, referenceId },
            });
          }
        }
      } catch (err) {
        logger.error("customer_txn_email_failed", {
          businessId,
          referenceId,
          event,
          err,
        });
        await AlertDeliveryLogService.record(businessId, {
          channel: "email",
          category: event === "completed" ? "portal_completion_receipt" : "customer_txn_status",
          status: "failed",
          audience: "customer",
          recipientCount: 1,
          failureCount: 1,
          detail: { event, referenceId },
        });
      }
    }
  }

  if (shouldSendSms && customer.phone) {
    const firstSms = await markChannelNotified(businessId, txId, "sms", event);
    if (firstSms) {
      const smsResult = await maybeSendCustomerTxnSms({
        businessId,
        customer,
        referenceId,
        statusLabel,
        trackUrl,
      });
      if (smsResult.sent) sent = true;
      await AlertDeliveryLogService.record(businessId, {
        channel: "sms",
        category: "customer_txn_status",
        status: smsResult.sent ? "sent" : "skipped",
        audience: "customer",
        recipientCount: 1,
        successCount: smsResult.sent ? 1 : 0,
        detail: { event, referenceId },
      });
    }
  }

  if (shouldSendWebPush) {
    const firstPush = await markChannelNotified(businessId, txId, "push", event);
    if (firstPush) {
      const pushResult = await maybeSendCustomerTxnWebPush({
        businessId,
        customerId,
        referenceId,
        statusLabel,
        trackUrl,
      });
      if (pushResult.sent) sent = true;
      await AlertDeliveryLogService.record(businessId, {
        channel: "push",
        category: "customer_txn_status",
        status: pushResult.skippedQuietHours ?
          "skipped" :
          pushResult.sent ?
            "sent" :
            "failed",
        audience: "customer",
        recipientCount: 1,
        successCount: pushResult.sent ? 1 : 0,
        detail: {
          event,
          referenceId,
          ...(pushResult.skippedQuietHours ? { reason: "quiet_hours" } : {}),
        },
      });
    }
  }

  return { sent };
}

/** NT-32 — email customer when payment becomes partial or paid. */
export async function maybeNotifyCustomerOnPaymentUpdate(args: {
  businessId: string;
  txId: string;
  before: Transaction | null;
  after: Transaction;
  skipBecauseCompleted?: boolean;
}): Promise<{ sent: boolean }> {
  const { businessId, txId, before, after, skipBecauseCompleted } = args;
  const customerId = after.customerId;
  const referenceId = String(after.referenceId || "");
  if (!customerId || !referenceId) return { sent: false };

  const paymentUpdate = mapPaymentUpdateNotifyKey({ before, after });
  if (!paymentUpdate) return { sent: false };

  if (skipBecauseCompleted && paymentUpdate.kind === "paid") {
    return { sent: false };
  }

  const txType = String(after.type || "").toLowerCase();
  if (
    paymentUpdate.kind === "paid" &&
    (txType === "walkin" || txType === "direct_sale")
  ) {
    return { sent: false };
  }

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return { sent: false };

  const shouldSendEmail = customerWantsEmail(customer);
  if (!shouldSendEmail || !customer.email?.includes("@")) {
    return { sent: false };
  }

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const biz = bizSnap.data() ?? {};
  const businessName = String(biz.name || "Your water station");
  const businessLogoUrl = resolveBusinessEmailLogoUrl(biz.logo);
  const trackUrl = buildTrackUrl(businessId, customerId, referenceId);

  const total = Number(after.totalAmount ?? 0);
  const paid = Number(after.amountPaid ?? 0);
  const balance = Number(after.balanceDue ?? Math.max(0, total - paid));

  const statusLabel =
    paymentUpdate.kind === "paid" ?
      "Payment received" :
      "Partial payment received";
  const detailLine =
    paymentUpdate.kind === "paid" ?
      `Fully paid na ang order mo sa ${businessName}. Salamat sa payment!` :
      `Nakatanggap kami ng partial payment. Natitirang balance: ${formatCustomerMoney(balance)}.`;

  const firstEmail = await markChannelNotified(
    businessId,
    txId,
    "email",
    paymentUpdate.eventKey,
  );
  if (!firstEmail) return { sent: false };

  const tpl = buildCustomerPaymentUpdateEmail({
    customerName: customer.name || after.customerName || "Customer",
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

  try {
    if (process.env.FUNCTIONS_EMULATOR) {
      logger.info("EMULATOR: customer payment update email", {
        businessId,
        referenceId,
        eventKey: paymentUpdate.eventKey,
      });
      await AlertDeliveryLogService.record(businessId, {
        channel: "email",
        category: tpl.brevoTag,
        status: "sent",
        audience: "customer",
        recipientCount: 1,
        successCount: 1,
        detail: { eventKey: paymentUpdate.eventKey, referenceId },
      });
      return { sent: true };
    }

    const api = getBrevoApi();
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = {
      name: businessName.slice(0, 60),
      email: "no-reply@smartrefill.io",
    };
    sendSmtpEmail.to = [
      {
        email: customer.email,
        name: customer.name || "Customer",
      },
    ];
    sendSmtpEmail.subject = tpl.subject;
    sendSmtpEmail.htmlContent = tpl.html;
    sendSmtpEmail.textContent = tpl.text;
    sendSmtpEmail.tags = [tpl.brevoTag, paymentUpdate.eventKey];
    await api.sendTransacEmail(sendSmtpEmail);

    await AlertDeliveryLogService.record(businessId, {
      channel: "email",
      category: tpl.brevoTag,
      status: "sent",
      audience: "customer",
      recipientCount: 1,
      successCount: 1,
      detail: { eventKey: paymentUpdate.eventKey, referenceId },
    });
    return { sent: true };
  } catch (err) {
    logger.error("customer_payment_update_email_failed", {
      businessId,
      referenceId,
      eventKey: paymentUpdate.eventKey,
      err,
    });
    await AlertDeliveryLogService.record(businessId, {
      channel: "email",
      category: tpl.brevoTag,
      status: "failed",
      audience: "customer",
      recipientCount: 1,
      failureCount: 1,
      detail: { eventKey: paymentUpdate.eventKey, referenceId },
    });
    return { sent: false };
  }
}

/** Walk-in / direct sale paid — treat as completed notification (NT-33). */
export async function maybeNotifyCustomerOnWalkInPaid(args: {
  businessId: string;
  txId: string;
  transaction: Transaction;
}): Promise<{ sent: boolean }> {
  const tx = args.transaction;
  const type = (tx.type || "").toLowerCase();
  if (type !== "walkin" && type !== "direct_sale") return { sent: false };
  if ((tx.paymentStatus || "").toLowerCase() !== "paid") return { sent: false };
  if ((tx.deliveryStatus || "").toLowerCase() === "cancelled") {
    return { sent: false };
  }

  const synthetic: Transaction = {
    ...tx,
    deliveryStatus: tx.deliveryStatus || "completed",
  };

  return maybeNotifyCustomerOnTransactionStatus({
    businessId: args.businessId,
    txId: args.txId,
    transaction: synthetic,
    event: "completed",
  });
}

export async function notifyCustomerOnTransactionStatusChange(
  businessId: string,
  txId: string,
  before: Transaction | null,
  after: Transaction,
): Promise<void> {
  const beforeStatus = before?.deliveryStatus;
  const completedSameUpdate =
    mapDeliveryStatusToEvent(beforeStatus, after.deliveryStatus) === "completed";

  await maybeNotifyCustomerOnTransactionStatus({
    businessId,
    txId,
    transaction: after,
    beforeStatus,
  });

  void maybeNotifyCustomerOnPaymentUpdate({
    businessId,
    txId,
    before,
    after,
    skipBecauseCompleted: completedSameUpdate,
  }).catch((err) => {
    logger.warn("customer_payment_update_notification_failed", {
      businessId,
      txId,
      err,
    });
  });

  const beforePaid = (before?.paymentStatus || "").toLowerCase();
  const afterPaid = (after.paymentStatus || "").toLowerCase();
  if (beforePaid !== "paid" && afterPaid === "paid") {
    await maybeNotifyCustomerOnWalkInPaid({
      businessId,
      txId,
      transaction: after,
    });
  }
}
