import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import { buildNewOrderOwnerEmail } from "../../utils/new-order-owner-email-template";
import { CustomerService } from "../customers/customer-service";
import type { RawSubmissionType } from "../portal/raw-submission-types";
import { AlertDeliveryLogService } from "./alert-delivery-log-service";
import { buildNewOrderPushCopy } from "./new-order-push-service";

/** Email the station when a customer places a portal / online order. */
export function submissionTypeNeedsOwnerOrderEmail(
  submissionType: RawSubmissionType,
): boolean {
  return submissionType === "PLACE_ORDER";
}

/**
 * Sends a one-off owner email when a customer requests an online order.
 */
export async function sendNewOrderOwnerEmailForSubmission(
  businessId: string,
  opts: {
    submissionId: string;
    submissionType: RawSubmissionType;
    customerId?: string;
    customerDisplayName?: string;
    referenceId: string;
    portalOrderKind?: string;
  },
): Promise<{ sent: boolean }> {
  if (!submissionTypeNeedsOwnerOrderEmail(opts.submissionType)) {
    return { sent: false };
  }

  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) return { sent: false };

  const data = (businessDoc.data() ?? {}) as Record<string, unknown>;
  const recipient = await resolveOwnerEmailForBusiness(data);
  if (!recipient) return { sent: false };

  const customerId = String(opts.customerId ?? "").trim();
  const customer = customerId ?
    await CustomerService.getCustomer(businessId, customerId) :
    null;
  const customerName =
    (customer?.name ?? "").trim() ||
    (opts.customerDisplayName ?? "").trim() ||
    "Customer";

  const copy = buildNewOrderPushCopy(
    opts.submissionType,
    customerName,
    opts.referenceId,
    opts.portalOrderKind,
  );
  const reviewUrl = `${resolveAppBaseUrlForEmail()}/online-orders`;
  const tpl = buildNewOrderOwnerEmail({
    ownerName: recipient.name,
    businessName: String(data.name || "Your station"),
    title: copy.title,
    body: copy.body,
    referenceId: opts.referenceId,
    reviewUrl,
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: new_order owner email", {
      businessId,
      email: recipient.email,
      submissionId: opts.submissionId,
      referenceId: opts.referenceId,
    });
    await AlertDeliveryLogService.record(businessId, {
      channel: "email",
      category: "new_order_owner_email",
      status: "sent",
      audience: "owner",
      recipientCount: 1,
      successCount: 1,
      detail: {
        referenceId: opts.referenceId,
        submissionId: opts.submissionId,
        emulator: true,
      },
    });
    return { sent: true };
  }

  try {
    const api = getBrevoApi();
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
    sendSmtpEmail.to = [{ email: recipient.email, name: recipient.name }];
    sendSmtpEmail.subject = tpl.subject;
    sendSmtpEmail.htmlContent = tpl.html;
    sendSmtpEmail.textContent = tpl.text;
    sendSmtpEmail.tags = [tpl.brevoTag];
    await api.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    logger.warn("new_order owner email failed", {
      businessId,
      submissionId: opts.submissionId,
      error,
    });
    await AlertDeliveryLogService.record(businessId, {
      channel: "email",
      category: "new_order_owner_email",
      status: "failed",
      audience: "owner",
      recipientCount: 1,
      successCount: 0,
      failureCount: 1,
      detail: {
        referenceId: opts.referenceId,
        submissionId: opts.submissionId,
      },
    });
    return { sent: false };
  }

  await AlertDeliveryLogService.record(businessId, {
    channel: "email",
    category: "new_order_owner_email",
    status: "sent",
    audience: "owner",
    recipientCount: 1,
    successCount: 1,
    detail: {
      referenceId: opts.referenceId,
      submissionId: opts.submissionId,
    },
  });

  logger.info("new_order owner email sent", {
    businessId,
    submissionId: opts.submissionId,
    referenceId: opts.referenceId,
  });

  return { sent: true };
}
