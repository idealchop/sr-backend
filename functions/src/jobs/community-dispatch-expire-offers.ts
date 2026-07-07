import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { expireStaleCommunityDispatchOffers } from "../services/meta/community-dispatch-offer-service";
import { sendCommunityWaitNudgesIfDue } from "../services/meta/community-dispatch-wait-nudge-service";

/** Expire pending community dispatch offers; notify customer when all stations pass. */
export const communityDispatchExpireOffers = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const result = await expireStaleCommunityDispatchOffers(40);
    const nudgeCount = await sendCommunityWaitNudgesIfDue(25);
    if (result.expiredCount > 0 || result.exhaustedCount > 0 || nudgeCount > 0) {
      logger.info("communityDispatchExpireOffers complete", { ...result, nudgeCount });
    }
  },
);
