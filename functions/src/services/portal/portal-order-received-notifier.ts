import { db } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
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
 * NT-31 — order-received email is retired. Only a completion PDF receipt is emailed.
 * Web push still fires when the suki opted in.
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

  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const businessName = String(businessDoc.data()?.name || "Your water station");

  logger.info("portal_order_received_email_skipped_completion_only", {
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

  return { sent: false };
}
