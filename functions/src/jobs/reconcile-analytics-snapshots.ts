import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import { AnalyticsMaterializerService } from
  "../services/analytics/analytics-materializer-service";

const BUSINESSES_PER_RUN = 20;

/**
 * Nightly full reconcile of analytics_daily + dashboard_kpis (Asia/Manila).
 * Prefer dirty stations; fill remaining slots with recently updated businesses.
 */
export const reconcileAnalyticsSnapshots = onSchedule(
  {
    schedule: "every day 02:45",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const dirtySnap = await db
      .collection("businesses")
      .where("analyticsDirtyAt", "!=", null)
      .limit(BUSINESSES_PER_RUN)
      .get()
      .catch(() => null);

    const selected = new Map<string, "dirty" | "recent">();
    for (const doc of dirtySnap?.docs ?? []) {
      selected.set(doc.id, "dirty");
    }

    if (selected.size < BUSINESSES_PER_RUN) {
      const recentSnap = await db
        .collection("businesses")
        .orderBy("updatedAt", "desc")
        .limit(BUSINESSES_PER_RUN)
        .get();
      for (const doc of recentSnap.docs) {
        if (selected.size >= BUSINESSES_PER_RUN) break;
        if (!selected.has(doc.id)) selected.set(doc.id, "recent");
      }
    }

    let rebuilt = 0;
    let failed = 0;

    for (const [businessId, pickReason] of selected) {
      try {
        await AnalyticsMaterializerService.materialize(businessId, {
          mode: "full",
          reason: `nightly_${pickReason}`,
        });
        rebuilt += 1;
      } catch (error) {
        failed += 1;
        logger.error("reconcileAnalyticsSnapshots business failed", {
          businessId,
          pickReason,
          error,
        });
      }
    }

    logger.info("reconcileAnalyticsSnapshots complete", {
      selected: selected.size,
      rebuilt,
      failed,
    });
  },
);
