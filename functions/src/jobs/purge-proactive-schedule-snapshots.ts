import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { ProactiveScheduleWeekSnapshotService } from
  "../services/proactive-schedule/proactive-schedule-week-snapshot-service";

/**
 * Deletes `proactive_schedule_week_snapshots` docs whose `expireAt` is in the past.
 * Run even if Firestore TTL is enabled on `expireAt` (TTL can lag slightly; this is a safety net).
 */
export const purgeExpiredProactiveScheduleWeekSnapshots = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const n =
        await ProactiveScheduleWeekSnapshotService.deleteExpiredBatch(500);
      total += n;
      if (n < 500) break;
    }
    logger.info("purgeExpiredProactiveScheduleWeekSnapshots complete", {
      deletedApprox: total,
    });
  },
);
