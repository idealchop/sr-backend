import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
import { db } from "../config/firebase-admin";

/**
 * MP-11 — nightly PM recurrence: roll gallon counters from production shifts.
 */
export const pmRecurrenceScheduler = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const businessesSnap = await db.collection("businesses").select().get();
    let updated = 0;

    for (const businessDoc of businessesSnap.docs) {
      const businessId = businessDoc.id;
      try {
        const count = await MaintenanceTemplateService.syncGallonRecurrence(businessId);
        updated += count;
      } catch (error) {
        logger.error("pmRecurrenceScheduler business failed", { businessId, error });
      }
    }

    logger.info("pmRecurrenceScheduler complete", {
      businesses: businessesSnap.size,
      updated,
    });
  },
);
