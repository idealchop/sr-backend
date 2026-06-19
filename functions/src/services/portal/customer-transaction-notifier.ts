import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import {
  type Transaction,
} from "../transactions/transaction-service";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { buildCustomerTxnStatusEmail } from "../../utils/customer-txn-status-email-template";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { sendTransactionCompletionReceiptEmail } from "./transaction-completion-receipt-email";
import { maybeSendCustomerTxnSms } from "./customer-sms-notifier";
import { maybeSendCustomerTxnWebPush } from "./customer-web-push-notifier";

export type CustomerTxnNotifyEvent =
  | "order_accepted"
  | "in_transit"
  | "completed"
  | "cancelled";

const EVENT_STATUS_LABEL: Record<CustomerTxnNotifyEvent, string> = {
  order_accepted: "Order accepted",
  in_transit: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
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

function mapDeliveryStatusToEvent(
  before: string | undefined,
  after: string | undefined,
): CustomerTxnNotifyEvent | null {
  const prev = (before || "").toLowerCase();
  const next = (after || "").toLowerCase();
  if (next === "cancelled" && prev !== "cancelled") return "cancelled";
  if (next === "completed" && prev !== "completed") return "completed";
  if (
    (next === "in_transit" || next === "out_for_delivery") &&
    prev !== next
  ) {
    return "in_transit";
  }
  if (
    (next === "accepted" || next === "confirmed" || next === "processing") &&
    (prev === "pending" || prev === "new" || !prev)
  ) {
    return "order_accepted";
  }
  return null;
}

function deliveryStatusLabel(status: string | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "in_transit" || s === "out_for_delivery") return "on the way";
  if (s === "completed") return "delivered";
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
  event: CustomerTxnNotifyEvent,
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
        } else {
          const tpl = buildCustomerTxnStatusEmail({
            customerName: customer.name || transaction.customerName || "Customer",
            businessName,
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
          }
        }
      } catch (err) {
        logger.error("customer_txn_email_failed", {
          businessId,
          referenceId,
          event,
          err,
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
    }
  }

  return { sent };
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
  await maybeNotifyCustomerOnTransactionStatus({
    businessId,
    txId,
    transaction: after,
    beforeStatus,
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

export { mapDeliveryStatusToEvent };
