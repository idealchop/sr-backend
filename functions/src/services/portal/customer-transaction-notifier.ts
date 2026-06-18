import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildCustomerTxnStatusEmail } from "../../utils/customer-txn-status-email-template";
import { CustomerService, type Customer } from "../customers/customer-service";
import type { Transaction } from "../transactions/transaction-service";
import { deliveryStatusLabel } from "../notifications/station-activity-notification-service";
import { maybeSendCustomerTxnSms } from "./customer-sms-notifier";
import { maybeSendCustomerTxnWebPush } from "./customer-web-push-notifier";

export type CustomerTxnEvent =
  | "order_accepted"
  | "in_transit"
  | "completed"
  | "cancelled";

const EVENT_STATUS_LABEL: Record<CustomerTxnEvent, string> = {
  order_accepted: "Order accepted",
  in_transit: "Rider on the way",
  completed: "Order completed",
  cancelled: "Order cancelled",
};

function customerWantsEmail(customer: Customer | null): boolean {
  return customer?.portalEmailNotifications === true;
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

function mapDeliveryStatusToEvent(
  before: string | undefined,
  after: string | undefined,
): CustomerTxnEvent | null {
  if (!after || after === before) return null;
  if (after === "placed" && before === "pending") return "order_accepted";
  if (after === "in-transit") return "in_transit";
  if (after === "delivered" || after === "collected" || after === "completed") {
    return "completed";
  }
  if (after === "cancelled" || after === "failed") return "cancelled";
  return null;
}

async function markEventNotified(
  businessId: string,
  transactionId: string,
  event: CustomerTxnEvent,
): Promise<boolean> {
  const ref = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(transactionId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    const notified = Array.isArray(data.emailNotifiedEvents) ?
      [...data.emailNotifiedEvents] :
      [];
    if (notified.includes(event)) return false;
    notified.push(event);
    txn.update(ref, {
      emailNotifiedEvents: notified,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/**
 * NT-32 / NT-33 — unified customer transaction status notifications.
 */
export async function maybeSendCustomerTxnNotification(args: {
  businessId: string;
  transaction: Transaction & { id?: string };
  beforeStatus?: string;
  event?: CustomerTxnEvent;
}): Promise<{ sent: boolean }> {
  const { businessId, transaction } = args;
  const txId = transaction.id;
  const customerId = String(transaction.customerId || "").trim();
  const referenceId = String(transaction.referenceId || "").trim();
  if (!txId || !customerId || !referenceId) return { sent: false };

  if (transaction.type !== "delivery" && transaction.type !== "collection") {
    return { sent: false };
  }

  const event =
    args.event ??
    mapDeliveryStatusToEvent(args.beforeStatus, transaction.deliveryStatus);
  if (!event) return { sent: false };

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return { sent: false };

  const shouldSendEmail = customerWantsEmail(customer);
  const shouldSendSms = customer.portalSmsOptIn === true;
  const shouldSendWebPush = customer.portalWebPushEnabled === true;
  if (!shouldSendEmail && !shouldSendSms && !shouldSendWebPush) {
    return { sent: false };
  }

  const firstTime = await markEventNotified(businessId, txId, event);
  if (!firstTime) return { sent: false };

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
    try {
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
          email: customer.email,
        });
        sent = true;
      } else {
        const api = getBrevoApi();
        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.sender = {
          name: businessName.slice(0, 40),
          email: "no-reply@smartrefill.io",
        };
        sendSmtpEmail.to = [{
          email: customer.email!,
          name: customer.name,
        }];
        sendSmtpEmail.subject = tpl.subject;
        sendSmtpEmail.htmlContent = tpl.html;
        sendSmtpEmail.textContent = tpl.text;
        sendSmtpEmail.tags = [tpl.brevoTag, event];
        await api.sendTransacEmail(sendSmtpEmail);
        sent = true;
      }
    } catch (error) {
      logger.warn("customer_txn_email_failed", {
        businessId,
        referenceId,
        event,
        error,
      });
    }
  }

  if (shouldSendSms) {
    const sms = await maybeSendCustomerTxnSms({
      businessId,
      customer,
      referenceId,
      statusLabel,
      trackUrl,
    });
    if (sms.sent) sent = true;
  }

  if (shouldSendWebPush) {
    const push = await maybeSendCustomerTxnWebPush({
      businessId,
      customerId,
      referenceId,
      statusLabel,
      trackUrl,
    });
    if (push.sent) sent = true;
  }

  return { sent };
}

export { mapDeliveryStatusToEvent };
