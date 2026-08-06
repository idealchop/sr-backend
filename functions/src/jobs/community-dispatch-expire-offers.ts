import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { expireStaleCommunityDispatchOffers } from "../services/meta/community-dispatch-offer-service";
import { sendCommunityWaitNudgesIfDue } from "../services/meta/community-dispatch-wait-nudge-service";
import { trackFirestoreOperation } from "../services/observability/cost-analytics/firestore-op-tracker";

/**
 * Kill switch — community dispatch expire/nudge cron.
 * Default **off** (feature idle). Set COMMUNITY_DISPATCH_EXPIRE_ENABLED=1 to run.
 */
export function isCommunityDispatchExpireEnabled(): boolean {
  return process.env.COMMUNITY_DISPATCH_EXPIRE_ENABLED === "1";
}

/**
 * Expire pending community dispatch offers; notify customer when all stations pass.
 * Prefer expiresAt-bounded query so idle pending rows are not scanned.
 */
export async function runCommunityDispatchExpireOffers(): Promise<void> {
  if (!isCommunityDispatchExpireEnabled()) {
    logger.info("communityDispatchExpireOffers skipped — disabled", {
      remark: "feature_idle",
      app: "smartrefill",
      operation: "community.dispatch.expire",
    });
    return;
  }

  const result = await expireStaleCommunityDispatchOffers(40);
  trackFirestoreOperation({
    app: "smartrefill",
    operation: "community.dispatch.expire",
    reads: result.scannedCount,
    writes: result.expiredCount,
    extra: {
      exhaustedCount: result.exhaustedCount,
      usedExpiresAtQuery: result.usedExpiresAtQuery,
    },
  });

  const nudgeCount = await sendCommunityWaitNudgesIfDue(25);
  if (result.expiredCount > 0 || result.exhaustedCount > 0 || nudgeCount > 0) {
    logger.info("communityDispatchExpireOffers complete", {
      ...result,
      nudgeCount,
      app: "smartrefill",
    });
  }
}

export const communityDispatchExpireOffers = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  runCommunityDispatchExpireOffers,
);
