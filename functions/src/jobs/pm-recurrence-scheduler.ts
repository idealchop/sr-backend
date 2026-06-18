import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase-admin";
import { ProductionShiftService } from "../services/plant/production-shift-service";
import {
  serializeMaintenanceTemplate,
  sumGallonsSinceLastComplete,
} from "../services/plant/maintenance-template-utils";
import { manilaDateKey } from "../utils/philippine-datetime";

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
        const templatesSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("maintenance_templates")
          .get();
        if (templatesSnap.empty) continue;

        const shifts = await ProductionShiftService.list(businessId, { limit: 90 });
        const batch = db.batch();
        let batchCount = 0;

        for (const templateDoc of templatesSnap.docs) {
          const template = serializeMaintenanceTemplate(templateDoc.id, templateDoc.data());
          if (!template.dueAfterGallons) continue;

          const gallons = sumGallonsSinceLastComplete(
            shifts,
            template.lastCompletedAt,
          );
          if (gallons === template.gallonsSinceLastComplete) continue;

          const updates: Record<string, unknown> = {
            gallonsSinceLastComplete: gallons,
            updatedAt: FieldValue.serverTimestamp(),
          };

          if (gallons >= template.dueAfterGallons) {
            const today = manilaDateKey(new Date());
            if (template.nextDueAt > today) {
              updates.nextDueAt = today;
            }
          }

          batch.update(templateDoc.ref, updates);
          batchCount += 1;
        }

        if (batchCount > 0) {
          await batch.commit();
          updated += batchCount;
        }
      } catch (error) {
        logger.error("pmRecurrenceScheduler business failed", { businessId, error });
      }
    }

    logger.info("pmRecurrenceScheduler complete", { businesses: businessesSnap.size, updated });
  },
);
