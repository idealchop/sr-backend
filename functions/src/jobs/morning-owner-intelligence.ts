import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import {
  isMorningAlertHour,
  listBusinessesForMorningAlerts,
} from "../services/notifications/morning-alerts-business-list";
import { runProactiveAlertsForBusiness } from
  "../services/notifications/proactive-alert-runner-service";
import { manilaHour } from "../utils/philippine-datetime";

/**
 * BL-07 + BL-16 + NT-70 — hourly morning owner intelligence via unified alert runner.
 */
export const morningOwnerIntelligence = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: ["SMARTREFILL_BREVO_API_KEY", "GEMINI_API_KEY"],
  },
  async () => {
    if (!isMorningAlertHour()) {
      logger.info("morningOwnerIntelligence skipped — outside alert hour window", {
        hour: manilaHour(),
      });
      return;
    }

    const businessIds = await listBusinessesForMorningAlerts();
    let briefsRun = 0;
    let emailsSent = 0;
    let morningBriefEmailsSent = 0;
    let paymentReminderEmailsSent = 0;
    let maintenanceEmailsSent = 0;
    let collectionsPulseRun = 0;

    for (const businessId of businessIds) {
      try {
        const results = await runProactiveAlertsForBusiness(businessId);
        for (const r of results) {
          if (r.contributorId === "morning_brief" && r.sent) briefsRun += 1;
          if (r.contributorId === "dormant_email" && r.sent) emailsSent += 1;
          if (r.contributorId === "morning_brief_email" && r.sent) {
            morningBriefEmailsSent += 1;
          }
          if (r.contributorId === "payment_reminder_email" && r.sent) {
            paymentReminderEmailsSent += 1;
          }
          if (r.contributorId === "maintenance_overdue_email" && r.sent) {
            maintenanceEmailsSent += 1;
          }
          if (r.contributorId === "collections_pulse" && r.sent) {
            collectionsPulseRun += 1;
          }
        }
      } catch (error) {
        logger.error("morningOwnerIntelligence business failed", {
          businessId,
          error,
        });
      }
    }

    logger.info("morningOwnerIntelligence complete", {
      hour: manilaHour(),
      scanned: businessIds.length,
      briefsRun,
      emailsSent,
      morningBriefEmailsSent,
      paymentReminderEmailsSent,
      maintenanceEmailsSent,
      collectionsPulseRun,
    });
  },
);
