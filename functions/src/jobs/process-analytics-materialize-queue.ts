import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";
import {
  ANALYTICS_MATERIALIZE_QUEUE_COLLECTION,
  AnalyticsMaterializerService,
} from "../services/analytics/analytics-materializer-service";
import {
  canStartMaterializeRun,
  parseMaterializeQueueDoc,
} from "../services/analytics/analytics-materialize-coalesce";

/** Pending queue docs scanned per tick (single-field `pending ==` query, auto index). */
const QUEUE_SCAN_LIMIT = 100;
/** Stop starting new rebuilds after this much of the 120 s timeout. */
const RUN_BUDGET_MS = 90_000;

/**
 * Trailing-edge rebuilds for coalesced analytics: every pending business whose
 * coalesce window has passed gets one incremental rebuild under a lease.
 * @param {number} [nowMs] Clock override (tests).
 * @return {Promise<Object>} Counts.
 */
export async function runProcessAnalyticsMaterializeQueue(
  nowMs?: number,
): Promise<{ scanned: number; rebuilt: number; deferred: number; failed: number }> {
  const startedAt = Date.now();
  const clock = () => nowMs ?? Date.now();
  const snap = await db
    .collection(ANALYTICS_MATERIALIZE_QUEUE_COLLECTION)
    .where("pending", "==", true)
    .limit(QUEUE_SCAN_LIMIT)
    .get();

  let rebuilt = 0;
  let deferred = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      deferred += 1;
      continue;
    }
    if (!canStartMaterializeRun(parseMaterializeQueueDoc(doc.data()), clock())) {
      deferred += 1;
      continue;
    }
    try {
      const leaseId = await AnalyticsMaterializerService.tryAcquireMaterializeLease(
        doc.id,
        clock(),
      );
      if (!leaseId) {
        deferred += 1;
        continue;
      }
      const result = await AnalyticsMaterializerService.runLeasedMaterialize(
        doc.id,
        leaseId,
        "coalesced",
        nowMs,
      );
      if (result) rebuilt += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      logger.error("processAnalyticsMaterializeQueue business failed", {
        businessId: doc.id,
        error,
      });
    }
  }

  const summary = { scanned: snap.size, rebuilt, deferred, failed };
  if (snap.size > 0) logger.info("processAnalyticsMaterializeQueue complete", summary);
  return summary;
}

export const processAnalyticsMaterializeQueue = onSchedule(
  {
    schedule: "every 2 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 120,
  },
  async () => {
    await runProcessAnalyticsMaterializeQueue();
  },
);
