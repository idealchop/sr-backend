import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import {
  isMorningAlertHour,
  listBusinessesForMorningAlerts,
} from "../services/notifications/morning-alerts-business-list";
import { runAutoMorningBriefForBusiness } from
  "../services/notifications/morning-brief-scheduler-service";
import { sendDormantDigestEmailForBusiness } from
  "../services/notifications/dormant-digest-email-service";
import { manilaHour } from "../utils/philippine-datetime";

/**
 * BL-07 + BL-16 — hourly morning owner intelligence (AI brief + weekly email).
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

    for (const businessId of businessIds) {
      try {
        let briefSummary: string | null = null;

        const briefResult = await runAutoMorningBriefForBusiness(businessId);
        if (briefResult.ran && briefResult.runId) {
          briefsRun += 1;
          const runDoc = await db
            .collection("businesses")
            .doc(businessId)
            .collection("ai_tool_runs")
            .doc(briefResult.runId)
            .get();
          const summary = runDoc.data()?.summary;
          if (typeof summary === "string" && summary.trim()) {
            briefSummary = summary.trim();
          }
        }

        const emailResult = await sendDormantDigestEmailForBusiness(
          businessId,
          briefSummary,
        );
        if (emailResult.sent) emailsSent += 1;
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
    });
  },
);
