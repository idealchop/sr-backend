import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import type { RawSubmission, RawSubmissionType } from "../portal/raw-submission-types";
import { CustomerService } from "../customers/customer-service";
import { buildNewOrderPushCopy } from "./new-order-push-service";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";

const REMINDER_TYPES = new Set<RawSubmissionType>([
  "PLACE_ORDER",
  "REQUEST_COLLECTION",
  "MARK_TX_COMPLETE",
  "COMPLETE_TX",
  "PORTAL_PAY_BALANCE",
]);

const PENDING_HOURS = 4;

function submissionAgeHours(submittedAt: unknown, now: Date): number | null {
  if (!submittedAt) return null;
  let d: Date | null = null;
  if (submittedAt instanceof Date) d = submittedAt;
  else if (typeof submittedAt === "string") d = new Date(submittedAt);
  else if (
    typeof submittedAt === "object" &&
    submittedAt !== null &&
    typeof (submittedAt as { toDate?: () => Date }).toDate === "function"
  ) {
    d = (submittedAt as { toDate: () => Date }).toDate();
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60);
}

async function listPendingReviewSubmissions(
  businessId: string,
): Promise<RawSubmission[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions")
    .where("status", "==", "pending_review")
    .limit(50)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<RawSubmission, "id">),
  }));
}

/**
 * NT-06 — remind owner when portal submissions sit in pending_review too long.
 */
export async function sendPendingSubmissionReminderForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean; pendingCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false, pendingCount: 0 };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.incomingRequestReminderPushEnabled !== true) {
    return { sent: false, pendingCount: 0 };
  }
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) {
    return { sent: false, pendingCount: 0 };
  }

  const today = manilaDateKey(now);
  if (data.incomingRequestReminderLastSentDate === today) {
    return { sent: false, pendingCount: 0 };
  }

  const submissions = await listPendingReviewSubmissions(businessId);
  const stale = submissions.filter((s) => {
    if (!REMINDER_TYPES.has(s.submissionType)) return false;
    const age = submissionAgeHours(s.submittedAt ?? s.metadata?.submittedAt, now);
    return age != null && age >= PENDING_HOURS;
  });

  if (stale.length === 0) return { sent: false, pendingCount: 0 };

  const devices = await listOwnerDevices(businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) return { sent: false, pendingCount: stale.length };

  const top = stale[0];
  const customer = top.customerId ?
    await CustomerService.getCustomer(businessId, top.customerId) :
    null;
  const copy = buildNewOrderPushCopy(
    top.submissionType,
    customer?.name ?? "Customer",
    top.referenceId ?? "",
  );

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: `${stale.length} pending portal request${stale.length === 1 ? "" : "s"}`,
    body: `${copy.body} — waiting ${PENDING_HOURS}+ hours.`,
    data: {
      type: "incoming_request_reminder",
      businessId,
      deepLink: "/dashboard?proactive=orders",
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(businessId, invalidTokens);
  }

  if (successCount <= 0) return { sent: false, pendingCount: stale.length };

  await businessRef.set(
    {
      incomingRequestReminderLastSentDate: today,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("incoming_request_reminder_sent", {
    businessId,
    pendingCount: stale.length,
  });

  return { sent: true, pendingCount: stale.length };
}
