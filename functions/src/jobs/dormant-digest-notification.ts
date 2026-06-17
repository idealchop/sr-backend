import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { listBusinessIdsWithOwnerDevices } from
  "../services/notifications/owner-device-service";
import { sendDormantDigestForBusiness } from
  "../services/notifications/dormant-digest-service";
import { manilaHour } from "../utils/philippine-datetime";
import { DORMANT_PUSH_HOUR_OPTIONS } from "../utils/notification-preferences";

/**
 * Hourly BL-01 job: sends dormant digest push at each business's chosen Manila hour.
 */
export const dormantDigestNotification = onSchedule(
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
      logger.info("dormantDigestNotification skipped — outside push hour window", {
        hour,
      });
      return;
    }

    const businessIds = await listBusinessIdsWithOwnerDevices();
    let sent = 0;
    let scanned = 0;

    for (const businessId of businessIds) {
      scanned += 1;
      try {
        const result = await sendDormantDigestForBusiness(businessId);
        if (result.sent) sent += 1;
      } catch (error) {
        logger.error("dormantDigestNotification business failed", {
          businessId,
          error,
        });
      }
    }

    logger.info("dormantDigestNotification complete", {
      hour,
      scanned,
      sent,
    });
  },
);
