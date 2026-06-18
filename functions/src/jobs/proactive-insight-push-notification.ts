import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { listBusinessIdsWithOwnerDevices } from
  "../services/notifications/owner-device-service";
import { sendProactiveInsightPushesForBusiness } from
  "../services/notifications/proactive-insight-push-service";
import { sendPendingSubmissionReminderForBusiness } from
  "../services/notifications/pending-submission-reminder-service";
import { manilaHour } from "../utils/philippine-datetime";
import { DORMANT_PUSH_HOUR_OPTIONS } from "../utils/notification-preferences";

/**
 * NT-01 / NT-02 / NT-03 / NT-04 — hourly proactive insight pushes at each business's send hour.
 */
export const proactiveInsightPushNotification = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const hour = manilaHour();
    if (!(DORMANT_PUSH_HOUR_OPTIONS as readonly number[]).includes(hour)) {
      logger.info("proactiveInsightPushNotification skipped — outside push hour window", {
        hour,
      });
      return;
    }

    const businessIds = await listBusinessIdsWithOwnerDevices();
    let paymentSent = 0;
    let maintenanceSent = 0;
    let varianceSent = 0;
    let reorderSent = 0;
    let slaSent = 0;
    let pendingReminderSent = 0;

    for (const businessId of businessIds) {
      try {
        const result = await sendProactiveInsightPushesForBusiness(businessId);
        if (result.payment) paymentSent += 1;
        if (result.maintenance) maintenanceSent += 1;
        if (result.variance) varianceSent += 1;
        if (result.reorder) reorderSent += 1;
        if (result.sla) slaSent += 1;

        const pending = await sendPendingSubmissionReminderForBusiness(businessId);
        if (pending.sent) pendingReminderSent += 1;
      } catch (error) {
        logger.error("proactiveInsightPushNotification business failed", {
          businessId,
          error,
        });
      }
    }

    logger.info("proactiveInsightPushNotification complete", {
      hour,
      scanned: businessIds.length,
      paymentSent,
      maintenanceSent,
      varianceSent,
      reorderSent,
      slaSent,
      pendingReminderSent,
    });
  },
);
