/**
 * Dev-tier schedulers and triggers (riverdb-dev).
 *
 * Deploy only with `ENV=dev DEPLOY_DEV_JOBS=1 ./deploy.sh`.
 * Runtime no-ops when SMARTREFILL_DEV_JOBS_ENABLED=false.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { isDevJobsEnabled } from "../config/dev-tier";
import { runPurgeExpiredProactiveScheduleWeekSnapshots } from
  "../jobs/purge-proactive-schedule-snapshots";
import { runPurgeExpiredTeamChats } from "../jobs/purge-expired-team-chats";
import { runBackfillCustomerLastFulfilled } from
  "../jobs/backfill-customer-last-fulfilled";
import { runReconcileAnalyticsSnapshots } from
  "../jobs/reconcile-analytics-snapshots";
import { runDormantDigestNotification } from "../jobs/dormant-digest-notification";
import { runMorningOwnerIntelligence } from "../jobs/morning-owner-intelligence";
import { runProactiveInsightPushNotification } from
  "../jobs/proactive-insight-push-notification";
import { runPmRecurrenceScheduler } from "../jobs/pm-recurrence-scheduler";
import { runSubscriptionAutoRenewScheduler } from
  "../jobs/subscription-auto-renew-scheduler";
import { runCommunityDispatchExpireOffers } from
  "../jobs/community-dispatch-expire-offers";
import { runGuestWebinarReminders } from "../jobs/guest-webinar-reminders";
import { runOwnerDataWarehouseExport } from "../jobs/owner-data-warehouse-export";
import { runOnSubscriptionUpdated } from "../triggers/subscription-triggers";

async function runGated(name: string, fn: () => Promise<void>): Promise<void> {
  if (!isDevJobsEnabled()) {
    logger.info(`[${name}] skipped — SMARTREFILL_DEV_JOBS_ENABLED is not true`);
    return;
  }
  await fn();
}

export const purgeExpiredProactiveScheduleWeekSnapshotsDev = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  () => runGated(
    "purgeExpiredProactiveScheduleWeekSnapshotsDev",
    runPurgeExpiredProactiveScheduleWeekSnapshots,
  ),
);

export const purgeExpiredTeamChatsDev = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  () => runGated("purgeExpiredTeamChatsDev", runPurgeExpiredTeamChats),
);

export const backfillCustomerLastFulfilledDev = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  () => runGated("backfillCustomerLastFulfilledDev", runBackfillCustomerLastFulfilled),
);

export const reconcileAnalyticsSnapshotsDev = onSchedule(
  {
    schedule: "every day 02:45",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  () => runGated("reconcileAnalyticsSnapshotsDev", runReconcileAnalyticsSnapshots),
);

export const dormantDigestNotificationDev = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  () => runGated("dormantDigestNotificationDev", runDormantDigestNotification),
);

export const morningOwnerIntelligenceDev = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: ["SMARTREFILL_BREVO_API_KEY", "GEMINI_API_KEY"],
  },
  () => runGated("morningOwnerIntelligenceDev", runMorningOwnerIntelligence),
);

export const proactiveInsightPushNotificationDev = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  () => runGated(
    "proactiveInsightPushNotificationDev",
    runProactiveInsightPushNotification,
  ),
);

export const pmRecurrenceSchedulerDev = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  () => runGated("pmRecurrenceSchedulerDev", runPmRecurrenceScheduler),
);

export const subscriptionAutoRenewSchedulerDev = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: ["PAYMONGO_SECRET_KEY"],
  },
  () => runGated(
    "subscriptionAutoRenewSchedulerDev",
    runSubscriptionAutoRenewScheduler,
  ),
);

export const communityDispatchExpireOffersDev = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  () => runGated(
    "communityDispatchExpireOffersDev",
    runCommunityDispatchExpireOffers,
  ),
);

export const guestWebinarRemindersDev = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 180,
    secrets: ["SMARTREFILL_BREVO_API_KEY"],
  },
  () => runGated("guestWebinarRemindersDev", runGuestWebinarReminders),
);

export const ownerDataWarehouseExportDev = onSchedule(
  {
    schedule: "every day 02:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  () => runGated("ownerDataWarehouseExportDev", runOwnerDataWarehouseExport),
);

export const onSubscriptionUpdatedDev = onDocumentUpdated(
  {
    document: "businesses/{businessId}/subscriptions/{subscriptionId}",
    database: "riverdb-dev",
    region: "asia-southeast1",
  },
  async (event) => {
    await runGated("onSubscriptionUpdatedDev", async () => {
      await runOnSubscriptionUpdated(
        event as unknown as Parameters<typeof runOnSubscriptionUpdated>[0],
      );
    });
  },
);
