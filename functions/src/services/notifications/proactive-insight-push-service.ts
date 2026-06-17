import { db, FieldValue } from "../../config/firebase-admin";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { MaintenanceTemplateService } from "../plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../plant/maintenance-template-utils";
import { ProductionShiftService } from "../plant/production-shift-service";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildPaymentReminderQueue } from "../../utils/payment-reminder-queue";
import { buildProductionVarianceAlert } from "../../utils/production-variance-alert";
import {
  buildInventoryReorderAlert,
  resolveReorderAlertDaysAhead,
} from "../../utils/inventory-reorder-alert";
import { computePeakDemandSummary } from "../../utils/peak-demand-analytics";
import { InventoryService } from "../inventory/inventory-service";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";

const TX_LIMIT = 2000;

type PushResult = { sent: boolean };

async function sendOwnerPush(
  businessId: string,
  copy: { title: string; body: string; deepLink: string; type: string },
  lastSentField: string,
  now: Date,
): Promise<PushResult> {
  const devices = await listOwnerDevices(businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) return { sent: false };

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: copy.type,
      businessId,
      deepLink: copy.deepLink,
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(businessId, invalidTokens);
  }

  if (successCount > 0) {
    await db.collection("businesses").doc(businessId).set(
      {
        [lastSentField]: manilaDateKey(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true };
  }
  return { sent: false };
}

function usesDormantPushHour(
  uiConfig: Record<string, unknown>,
  now: Date,
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  return (
    Number(prefs.dormantPushHour) === manilaHour(now)
  );
}

/** NT-01 — daily payment reminder push at owner's dormant push hour.
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendPaymentReminderPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);

  if (
    prefs.paymentReminderEnabled !== true ||
    prefs.paymentReminderPushEnabled !== true
  ) {
    return { sent: false };
  }
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.paymentReminderPushLastSentDate === "string" ?
      data.paymentReminderPushLastSentDate :
      undefined;
  const today = manilaDateKey(now);
  if (lastSent === today) return { sent: false };

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const debt = computeDebtAgingBreakdown(transactions, customers);
  const queue = buildPaymentReminderQueue(debt.rows, customers, {
    paymentReminderEnabled: true,
    paymentReminder30Enabled: prefs.paymentReminder30Enabled !== false,
    paymentReminder60Enabled: prefs.paymentReminder60Enabled !== false,
    paymentReminder90Enabled: prefs.paymentReminder90Enabled !== false,
  });

  if (queue.length === 0) return { sent: false };

  const top = queue[0];
  const totalDue = queue.reduce((sum, row) => sum + row.amount, 0);
  const sukiLabel = queue.length === 1 ? "suki" : "sukis";

  return sendOwnerPush(
    businessId,
    {
      title: `Call ${queue.length} ${sukiLabel} today`,
      body:
        queue.length === 1 ?
          `${top.name} owes ₱${Math.round(top.amount).toLocaleString("en-PH")} ` +
            `(${top.oldestDebtDays}+ days).` :
          `${top.name} and ${queue.length - 1} more — ` +
            `₱${Math.round(totalDue).toLocaleString("en-PH")} total to collect.`,
      deepLink: "/dashboard",
      type: "payment_reminder",
    },
    "paymentReminderPushLastSentDate",
    now,
  );
}

/** NT-02 — maintenance overdue push (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendMaintenanceOverduePushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.maintenancePushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.maintenancePushLastSentDate === "string" ?
      data.maintenancePushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const templates = await MaintenanceTemplateService.list(businessId);
  const summary = summarizeMaintenanceOverdue(templates);
  if (summary.overdueCount <= 0) return { sent: false };

  const names = summary.overdueNames.slice(0, 2).join(", ");
  const extra =
    summary.overdueCount > 2 ?
      ` +${summary.overdueCount - 2} more` :
      "";

  return sendOwnerPush(
    businessId,
    {
      title: `${summary.overdueCount} maintenance overdue`,
      body: `Plant tasks due: ${names}${extra}. Open Plant ops → Maintenance.`,
      deepLink: "/inventory",
      type: "maintenance_overdue",
    },
    "maintenancePushLastSentDate",
    now,
  );
}

/** NT-03 — production vs sales variance push (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendProductionVariancePushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.productionVariancePushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.productionVariancePushLastSentDate === "string" ?
      data.productionVariancePushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const [shifts, transactions] = await Promise.all([
    ProductionShiftService.list(businessId, { limit: 14 }),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const alert = buildProductionVarianceAlert({
    shifts,
    transactions,
    uiConfig,
    now,
  });
  if (!alert.active) return { sent: false };

  return sendOwnerPush(
    businessId,
    {
      title: "Plant vs sales mismatch",
      body: alert.headline,
      deepLink: "/dashboard",
      type: "production_variance",
    },
    "productionVariancePushLastSentDate",
    now,
  );
}

/** NT-04 — inventory reorder before peak push (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendInventoryReorderPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.reorderPushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.reorderPushLastSentDate === "string" ?
      data.reorderPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const [inventory, transactions] = await Promise.all([
    InventoryService.listItems(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const peak = computePeakDemandSummary(transactions, now);
  const alert = buildInventoryReorderAlert(
    inventory,
    peak,
    now,
    resolveReorderAlertDaysAhead(uiConfig),
  );
  if (!alert.active || !alert.headline) return { sent: false };

  return sendOwnerPush(
    businessId,
    {
      title: "Restock before peak",
      body: alert.headline,
      deepLink: "/inventory",
      type: "inventory_reorder",
    },
    "reorderPushLastSentDate",
    now,
  );
}

export async function sendProactiveInsightPushesForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{
  payment: boolean;
  maintenance: boolean;
  variance: boolean;
  reorder: boolean;
}> {
  const [payment, maintenance, variance, reorder] = await Promise.all([
    sendPaymentReminderPushForBusiness(businessId, now),
    sendMaintenanceOverduePushForBusiness(businessId, now),
    sendProductionVariancePushForBusiness(businessId, now),
    sendInventoryReorderPushForBusiness(businessId, now),
  ]);
  return {
    payment: payment.sent,
    maintenance: maintenance.sent,
    variance: variance.sent,
    reorder: reorder.sent,
  };
}
