/** Enabled by `ENV=dev DEPLOY_DEV_JOBS=1 ./deploy.sh` (copied over dev-jobs-exports.ts). */
export const DEV_JOBS_REGISTERED = true;
export {
  purgeExpiredProactiveScheduleWeekSnapshotsDev,
  generateForecastScheduleWeekDev,
  scoreForecastScheduleWeekDev,
  purgeExpiredTeamChatsDev,
  backfillCustomerLastFulfilledDev,
  reconcileAnalyticsSnapshotsDev,
  dormantDigestNotificationDev,
  morningOwnerIntelligenceDev,
  inactiveAccountDeactivationDev,
  proactiveInsightPushNotificationDev,
  pmRecurrenceSchedulerDev,
  subscriptionAutoRenewSchedulerDev,
  // communityDispatchExpireOffersDev — disabled with prod (feature idle)
  guestWebinarRemindersDev,
  ownerDataWarehouseExportDev,
  onSubscriptionUpdatedDev,
} from "./dev-jobs";
