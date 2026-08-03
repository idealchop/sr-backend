import { onRequest } from "firebase-functions/v2/https";
import { api, app } from "./index-api";

// Brevo: production reads SMARTREFILL_BREVO_API_KEY from Secret Manager via `secrets` below.
// Local: SMARTREFILL_ENV_DEV=true + keys and APP_BASE_URL in functions/.env — never set
// SMARTREFILL_ENV_DEV on deployed functions (prod links always use https://app.smartrefill.io).

export { app };

export const smartrefillV3Api = onRequest(
  {
    region: "asia-southeast1",
    cors: true,
    // River AI Buddy + agent turns load workspace snapshots (customers/txs/inventory).
    // Default 256MiB OOMs under those paths and returns opaque HTTP 500s to the client.
    memory: "1GiB",
    timeoutSeconds: 120,
    secrets: [
      "DOCS_ADMIN_TOKEN",
      "SMARTREFILL_BREVO_API_KEY",
      "GEMINI_API_KEY",
      "SMARTREFILL_GOOGLE_MAPS_SERVER_API_KEY",
      "smartrefill-firebase-google-maps-api-key",
      "META_COMMUNITY_VERIFY_TOKEN",
      "META_COMMUNITY_PAGE_ACCESS_TOKEN",
      "META_COMMUNITY_PAGE_ID",
      "META_COMMUNITY_APP_SECRET",
      "PAYMONGO_SECRET_KEY",
      "PAYMONGO_WEBHOOK_SECRET",
    ],
  },
  api,
);

/** Dev tier HTTP API (riverdb-dev). Additive — does not replace smartrefillV3Api. */
export { smartrefillV3ApiDev } from "./dev/smartrefill-v3-api-dev";

export { purgeExpiredProactiveScheduleWeekSnapshots } from
  "./jobs/purge-proactive-schedule-snapshots";
export { purgeExpiredTeamChats } from "./jobs/purge-expired-team-chats";
export { backfillCustomerLastFulfilled } from "./jobs/backfill-customer-last-fulfilled";
export { reconcileAnalyticsSnapshots } from "./jobs/reconcile-analytics-snapshots";
export { dormantDigestNotification } from "./jobs/dormant-digest-notification";
export { morningOwnerIntelligence } from "./jobs/morning-owner-intelligence";
export { proactiveInsightPushNotification } from "./jobs/proactive-insight-push-notification";
export { pmRecurrenceScheduler } from "./jobs/pm-recurrence-scheduler";
export { subscriptionAutoRenewScheduler } from "./jobs/subscription-auto-renew-scheduler";
export { communityDispatchExpireOffers } from "./jobs/community-dispatch-expire-offers";
export { guestWebinarReminders } from "./jobs/guest-webinar-reminders";
export { ownerDataWarehouseExport } from "./jobs/owner-data-warehouse-export";
export { onSubscriptionUpdated } from "./triggers/subscription-triggers";

/** Optional Dev schedulers/triggers — empty unless DEPLOY_DEV_JOBS=1 (see deploy.sh). */
export * from "./dev/dev-jobs-exports";
