import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { notifyDueWebinarRegistrationOpens } from "../services/events-training/notify-webinar-registration-open-service";

/** Fan-out when webinar registrationOpensAt arrives. */
export async function runWebinarRegistrationOpenNotices(): Promise<void> {
  const result = await notifyDueWebinarRegistrationOpens(25);
  if (result.notified > 0 || result.eventsScanned > 0) {
    logger.info("webinarRegistrationOpenNotices complete", result);
  }
}

export const webinarRegistrationOpenNotices = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 180,
  },
  runWebinarRegistrationOpenNotices,
);
