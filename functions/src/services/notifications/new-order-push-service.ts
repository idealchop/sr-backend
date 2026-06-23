import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "../customers/customer-service";
import type { RawSubmissionType } from "../portal/raw-submission-types";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";

const REVIEW_SUBMISSION_TYPES = new Set<RawSubmissionType>([
  "PLACE_ORDER",
  "REQUEST_COLLECTION",
  "MARK_TX_COMPLETE",
  "COMPLETE_TX",
  "PORTAL_PAY_BALANCE",
]);

export type NewOrderPushCopy = {
  title: string;
  body: string;
};

export function submissionTypeNeedsReviewPush(
  submissionType: RawSubmissionType,
): boolean {
  return REVIEW_SUBMISSION_TYPES.has(submissionType);
}

export function buildNewOrderPushCopy(
  submissionType: RawSubmissionType,
  customerName: string,
  referenceId: string,
  portalOrderKind?: string,
): NewOrderPushCopy {
  const name = customerName.trim() || "A customer";
  const ref = referenceId.trim();

  switch (submissionType) {
  case "REQUEST_COLLECTION":
    return {
      title: "Collection request",
      body: `${name} submitted a collection request${ref ? ` (${ref})` : ""}.`,
    };
  case "PORTAL_PAY_BALANCE":
    return {
      title: "Portal payment",
      body: `${name} sent a balance payment${ref ? ` (${ref})` : ""}.`,
    };
  case "MARK_TX_COMPLETE":
  case "COMPLETE_TX":
    return {
      title: "Order completion",
      body: `${name} marked an order complete${ref ? ` (${ref})` : ""}.`,
    };
  case "PLACE_ORDER":
    if (portalOrderKind === "walkin") {
      return {
        title: "Counter walk-in",
        body: `${name} checked in at the counter${ref ? ` (${ref})` : ""}.`,
      };
    }
    if (portalOrderKind === "collection") {
      return {
        title: "Portal collection request",
        body: `${name} requested collection${ref ? ` (${ref})` : ""}.`,
      };
    }
    return {
      title: "New QR order",
      body: `${name} placed a delivery order${ref ? ` (${ref})` : ""}.`,
    };
  default:
    return {
      title: "New portal order",
      body: `${name} placed an order${ref ? ` (${ref})` : ""}.`,
    };
  }
}

/**
 * Sends immediate FCM when a reviewable raw_submission is created (portal / future channels).
 * @param {string} businessId Business that owns the submission.
 * @param {object} opts Submission context for copy and routing.
 * @param {string} opts.submissionId Raw submission document id.
 * @param {RawSubmissionType} opts.submissionType Portal submission type.
 * @param {string} [opts.customerId] Customer linked to the submission (may be empty).
 * @param {string} [opts.customerDisplayName] Fallback name from payload when no customer doc.
 * @param {string} opts.referenceId Human-readable reference for push body.
 * @return {Promise<{ sent: boolean }>} Whether at least one device received the push.
 */
export async function sendNewOrderPushForSubmission(
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
  if (!submissionTypeNeedsReviewPush(opts.submissionType)) {
    return { sent: false };
  }

  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) return { sent: false };

  const uiConfig = (businessDoc.data()?.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.newOrderPushEnabled !== true) {
    return { sent: false };
  }

  const customerId = String(opts.customerId ?? "").trim();
  const [customer, devices] = await Promise.all([
    customerId ?
      CustomerService.getCustomer(businessId, customerId) :
      Promise.resolve(null),
    listOwnerDevices(businessId),
  ]);

  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) {
    return { sent: false };
  }

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

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: "new_order",
      businessId,
      submissionId: opts.submissionId,
      referenceId: opts.referenceId,
      deepLink: "/dashboard?proactive=orders",
    },
  }, {
    deliveryLog: {
      businessId,
      category: "new_order_push",
      audience: "owner",
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(businessId, invalidTokens);
  }

  if (successCount <= 0) {
    return { sent: false };
  }

  logger.info("new_order push sent", {
    businessId,
    submissionId: opts.submissionId,
    submissionType: opts.submissionType,
    successCount,
  });

  return { sent: true };
}
