import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { sendDueGuestWebinarReminders } from "../services/events-training/guest-webinar-reminder-service";

/** Guest webinar T-~1h reminder fan-out (Brevo). */
export const guestWebinarReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 180,
    secrets: ["SMARTREFILL_BREVO_API_KEY"],
  },
  async () => {
    const result = await sendDueGuestWebinarReminders(40);
    if (result.remindersSent > 0 || result.eventsScanned > 0) {
      logger.info("guestWebinarReminders complete", result);
    }
  },
);
