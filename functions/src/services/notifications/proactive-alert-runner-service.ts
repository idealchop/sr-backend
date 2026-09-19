import { sendProactiveInsightPushesForBusiness } from "./proactive-insight-push-service";
import { sendPendingSubmissionReminderForBusiness } from "./pending-submission-reminder-service";
import { sendDormantDigestEmailForBusiness } from "./dormant-digest-email-service";
import { sendPaymentReminderOwnerEmailForBusiness } from "./payment-reminder-owner-email-service";
import { sendMaintenanceOverdueEmailForBusiness } from "./maintenance-overdue-email-service";
import { runAutoDispatchHealthForBusiness } from "./dispatch-health-scheduler-service";
import { runAutoWarehouseRiskForBusiness } from "./warehouse-risk-scheduler-service";
import {
  sendWeeklyPerformanceEmailForBusiness,
  sendSubscriptionLifecycleEmailForBusiness,
  sendProductionVarianceEmailForBusiness,
  sendLowStockDigestEmailForBusiness,
  sendTeamActivityDigestEmailForBusiness,
} from "./owner-email-digest-services";
import { runPlantAlertsForBusiness } from "./plant-alert-service";
import { isBusinessEligibleForStationAlerts } from "../../utils/scale-plan-access";
import {
  AlertDeliveryLogService,
  mapContributorToDeliveryLog,
} from "./alert-delivery-log-service";

export type AlertContributorId =
  | "proactive_push"
  | "pending_submission_reminder"
  | "morning_brief"
  | "collections_pulse"
  | "dispatch_health_auto"
  | "warehouse_risk_auto"
  | "dormant_email"
  | "morning_brief_email"
  | "payment_reminder_email"
  | "maintenance_overdue_email"
  | "weekly_performance_email"
  | "subscription_lifecycle_email"
  | "production_variance_email"
  | "low_stock_digest_email"
  | "team_digest_email"
  | "plant_alerts";

export type AlertRunResult = {
  contributorId: AlertContributorId;
  sent: boolean;
  detail?: Record<string, unknown>;
};

async function logAlertDelivery(
  businessId: string,
  result: AlertRunResult,
): Promise<void> {
  const input = mapContributorToDeliveryLog(
    result.contributorId,
    result.sent,
    result.detail,
  );
  await AlertDeliveryLogService.record(businessId, input);
}

/**
 * NT-70 — unified proactive alert runner (push + scheduled emails + auto AI tools).
 */
export async function runProactiveAlertsForBusiness(
  businessId: string,
  now = new Date(),
): Promise<AlertRunResult[]> {
  if (!(await isBusinessEligibleForStationAlerts(businessId))) {
    return [];
  }
  const results: AlertRunResult[] = [];

  const push = await sendProactiveInsightPushesForBusiness(businessId, now);
  const pushSent =
    push.payment ||
    push.maintenance ||
    push.variance ||
    push.reorder ||
    push.sla ||
    push.containerDeficit ||
    push.atRisk ||
    push.lowStock ||
    push.subscription;
  results.push({
    contributorId: "proactive_push",
    sent: pushSent,
    detail: push as Record<string, unknown>,
  });

  const pending = await sendPendingSubmissionReminderForBusiness(businessId, now);
  results.push({
    contributorId: "pending_submission_reminder",
    sent: pending.sent,
    detail: { pendingCount: pending.pendingCount },
  });

  const dispatchHealth = await runAutoDispatchHealthForBusiness(businessId, now);
  results.push({
    contributorId: "dispatch_health_auto",
    sent: dispatchHealth.ran,
    detail: dispatchHealth.runId ? { runId: dispatchHealth.runId } : {},
  });

  const warehouseRisk = await runAutoWarehouseRiskForBusiness(businessId, now);
  results.push({
    contributorId: "warehouse_risk_auto",
    sent: warehouseRisk.ran,
    detail: warehouseRisk.runId ? { runId: warehouseRisk.runId } : {},
  });

  const dormantEmail = await sendDormantDigestEmailForBusiness(
    businessId,
    null,
    now,
  );
  results.push({
    contributorId: "dormant_email",
    sent: dormantEmail.sent,
    detail: { dormantCount: dormantEmail.dormantCount },
  });

  const paymentEmail = await sendPaymentReminderOwnerEmailForBusiness(businessId, now);
  results.push({
    contributorId: "payment_reminder_email",
    sent: paymentEmail.sent,
    detail: { queueCount: paymentEmail.queueCount },
  });

  const maintenanceEmail = await sendMaintenanceOverdueEmailForBusiness(
    businessId,
    now,
  );
  results.push({
    contributorId: "maintenance_overdue_email",
    sent: maintenanceEmail.sent,
    detail: { overdueCount: maintenanceEmail.overdueCount },
  });

  const weeklyPerformance = await sendWeeklyPerformanceEmailForBusiness(businessId, now);
  results.push({
    contributorId: "weekly_performance_email",
    sent: weeklyPerformance.sent,
  });

  const subscriptionEmail = await sendSubscriptionLifecycleEmailForBusiness(
    businessId,
    now,
  );
  results.push({
    contributorId: "subscription_lifecycle_email",
    sent: subscriptionEmail.sent,
  });

  const varianceEmail = await sendProductionVarianceEmailForBusiness(businessId, now);
  results.push({
    contributorId: "production_variance_email",
    sent: varianceEmail.sent,
  });

  const lowStockEmail = await sendLowStockDigestEmailForBusiness(businessId, now);
  results.push({
    contributorId: "low_stock_digest_email",
    sent: lowStockEmail.sent,
    detail: { itemCount: lowStockEmail.itemCount },
  });

  const teamDigest = await sendTeamActivityDigestEmailForBusiness(businessId, now);
  results.push({
    contributorId: "team_digest_email",
    sent: teamDigest.sent,
  });

  const plantAlerts = await runPlantAlertsForBusiness(businessId, now);
  const plantSent = plantAlerts.some((r) => r.sent);
  results.push({
    contributorId: "plant_alerts",
    sent: plantSent,
    detail: {
      contributors: plantAlerts.map((r) => ({
        id: r.contributorId,
        sent: r.sent,
      })),
    },
  });

  await Promise.all(results.map((r) => logAlertDelivery(businessId, r)));

  return results;
}
