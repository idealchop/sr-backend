import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildPortalOrderReceivedEmail } from "../../utils/portal-order-received-email-template";
import { maybeSendPortalOrderReceivedWebPush } from "./customer-web-push-notifier";
import { CustomerService } from "../customers/customer-service";
import type { RawSubmissionPayload, RawSubmissionType } from "./raw-submission-types";

function resolveCustomerEmail(
  payload: RawSubmissionPayload,
  customerEmail?: string,
): string | null {
  const profileEmail = String(payload.profile?.email || "").trim();
  const fromCustomer = String(customerEmail || "").trim();
  const email = profileEmail || fromCustomer;
  return email.includes("@") ? email : null;
}

function customerWantsOrderEmail(
  payload: RawSubmissionPayload,
  customerEmailOptIn?: boolean,
): boolean {
  if (payload.profile?.portalEmailNotifications === true) return true;
  if (customerEmailOptIn === true) return true;
  return false;
}

function formatScheduledLabel(payload: RawSubmissionPayload): string | undefined {
  const scheduled = payload.scheduledAt;
  if (typeof scheduled !== "string" || !scheduled.trim()) return undefined;
  try {
    const d = new Date(scheduled);
    if (Number.isNaN(d.getTime())) return scheduled;
    return d.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return scheduled;
  }
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

/**
 * NT-31 — email customer when portal PLACE_ORDER is submitted (opt-in).
 */
export async function maybeSendPortalOrderReceivedEmail(params: {
  businessId: string;
  customerId: string;
  submissionType: RawSubmissionType;
  referenceId: string;
  payload: RawSubmissionPayload;
}): Promise<{ sent: boolean }> {
  const { businessId, customerId, submissionType, referenceId, payload } = params;
  if (submissionType !== "PLACE_ORDER") return { sent: false };

  const customer = customerId ?
    await CustomerService.getCustomer(businessId, customerId) :
    null;
  if (!customerWantsOrderEmail(payload, customer?.portalEmailNotifications)) {
    return { sent: false };
  }

  const email = resolveCustomerEmail(payload, customer?.email);
  if (!email) return { sent: false };

  const idempotencyKey = `order_received:${referenceId}`;
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const sentFlags = (businessDoc.data()?.customerEmailSentFlags ?? {}) as Record<
    string,
    boolean
  >;
  if (sentFlags[idempotencyKey]) return { sent: false };

  const businessName = String(businessDoc.data()?.name || "Your water station");
  const customerName =
    String(payload.profile?.name || customer?.name || "Suki").trim() || "Suki";
  const tpl = buildPortalOrderReceivedEmail({
    customerName,
    businessName,
    referenceId,
    trackUrl: buildTrackUrl(businessId, customerId, referenceId),
    scheduledLabel: formatScheduledLabel(payload),
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: portal order received email", {
      businessId,
      referenceId,
      email,
    });
    await businessRef.set(
      {
        [`customerEmailSentFlags.${idempotencyKey}`]: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true };
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: businessName.slice(0, 60),
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email, name: customerName }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];

  await api.sendTransacEmail(sendSmtpEmail);

  await businessRef.set(
    {
      [`customerEmailSentFlags.${idempotencyKey}`]: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("portal_order_received_email_sent", {
    businessId,
    referenceId,
    email,
  });

  void maybeSendPortalOrderReceivedWebPush({
    businessId,
    customerId,
    referenceId,
    businessName,
    trackUrl: buildTrackUrl(businessId, customerId, referenceId),
  }).catch((err) => {
    logger.warn("portal_order_received_web_push_failed", {
      businessId,
      referenceId,
      err,
    });
  });

  return { sent: true };
}
