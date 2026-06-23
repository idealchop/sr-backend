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
  listLowStockItems } from "../../utils/inventory-reorder-alert";
import { computePeakDemandSummary } from "../../utils/peak-demand-analytics";
import { InventoryService } from "../inventory/inventory-service";
import { buildContainerDeficitAlerts } from "../../utils/container-deficit-alert";
import { buildAtRiskDeliverySnapshot } from "../../utils/at-risk-delivery-alert";
import { buildSubscriptionLifecycleSnapshot } from "../../utils/subscription-lifecycle-alert";
import { listPendingOrderCustomerIds } from "./pending-submission-reminder-service";
import { resolveNotificationPreferencesFromUiConfig, resolveQuietHoursFromUiConfig } from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";
import {
  computeDeliverySlaMetrics,
  slaBreachAlertActive,
} from "../../utils/delivery-sla-metrics";

const TX_LIMIT = 2000;

type PushResult = { sent: boolean };

async function sendOwnerPush(
  businessId: string,
  copy: { title: string; body: string; deepLink: string; type: string },
  lastSentField: string,
  now: Date,
  uiConfig?: Record<string, unknown>,
): Promise<PushResult> {
  const devices = await listOwnerDevices(businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) return { sent: false };

  let config = uiConfig;
  if (!config) {
    const snap = await db.collection("businesses").doc(businessId).get();
    config = (snap.data()?.uiConfig ?? {}) as Record<string, unknown>;
  }
  const quietHours = resolveQuietHoursFromUiConfig(config);
  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: copy.type,
      businessId,
      deepLink: copy.deepLink,
    },
  }, {
    quietHoursStart: quietHours.start,
    quietHoursEnd: quietHours.end,
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
    uiConfig,
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
    uiConfig,
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
    uiConfig,
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
    uiConfig,
  );
}

/** NT-05 — SLA breach push when >25% deliveries exceed 24h (weekly max).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendSlaBreachPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.slaBreachPushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.slaBreachPushLastSentWeek === "string" ?
      data.slaBreachPushLastSentWeek :
      undefined;
  const weekKey = manilaDateKey(now);
  if (lastSent === weekKey) return { sent: false };

  const transactions = await TransactionService.getTransactionsByBusiness(
    businessId,
    { limit: TX_LIMIT },
  );
  const metrics = computeDeliverySlaMetrics(transactions, now);
  if (!slaBreachAlertActive(metrics)) return { sent: false };

  return sendOwnerPush(
    businessId,
    {
      title: "Delivery SLA breach",
      body:
        `${metrics.slaOver24hPct}% of stops took over 24h last ${metrics.periodDays} days ` +
        `(${metrics.slaBreachOver24hCount} stops) — check rider staffing.`,
      deepLink: "/dashboard",
      type: "sla_breach",
    },
    "slaBreachPushLastSentWeek",
    now,
    uiConfig,
  );
}

/** NT-07 — container deficit push (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendContainerDeficitPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.containerDeficitPushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.containerDeficitPushLastSentDate === "string" ?
      data.containerDeficitPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const minQty = Number(uiConfig.containerDeficitAlertMin);
  const threshold = Number.isFinite(minQty) && minQty >= 1 ? minQty : 1;

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
  ]);

  const snapshot = buildContainerDeficitAlerts(
    transactions,
    customers,
    now,
    undefined,
    threshold,
  );
  if (snapshot.count <= 0) return { sent: false };

  return sendOwnerPush(
    businessId,
    {
      title: `${snapshot.count} suki${snapshot.count === 1 ? "" : "s"} owe containers`,
      body:
        `${snapshot.totalDeficitQty} container${snapshot.totalDeficitQty === 1 ? "" : "s"} ` +
        "outstanding from recent deliveries — prioritize collection.",
      deepLink: "/customers",
      type: "container_deficit",
    },
    "containerDeficitPushLastSentDate",
    now,
    uiConfig,
  );
}

/** NT-08 — at-risk delivery push (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendAtRiskDeliveryPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.atRiskDeliveryPushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lastSent =
    typeof data.atRiskDeliveryPushLastSentDate === "string" ?
      data.atRiskDeliveryPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const [customers, transactions, pendingOrderIds] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
    listPendingOrderCustomerIds(businessId),
  ]);

  const snapshot = buildAtRiskDeliverySnapshot(
    transactions,
    customers,
    pendingOrderIds,
  );
  if (snapshot.count <= 0) return { sent: false };

  const hint =
    snapshot.rows[0]?.reasons[0] ?
      ` ${snapshot.rows[0].reasons[0]}` :
      "";

  return sendOwnerPush(
    businessId,
    {
      title: `${snapshot.count} at-risk deliver${snapshot.count === 1 ? "y" : "ies"}`,
      body:
        "Clear open deliveries and pending orders before win-back calls." +
        hint,
      deepLink: "/dashboard",
      type: "at_risk_delivery",
    },
    "atRiskDeliveryPushLastSentDate",
    now,
    uiConfig,
  );
}

/** NT-09 — low stock push when any SKU at/below minimum (max 1/day).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendLowStockPushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.lowStockPushEnabled !== true) return { sent: false };

  const lastSent =
    typeof data.lowStockPushLastSentDate === "string" ?
      data.lowStockPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const inventory = await InventoryService.listItems(businessId);
  const lowStock = listLowStockItems(inventory);
  if (lowStock.length === 0) return { sent: false };

  const label =
    lowStock.length === 1 ?
      lowStock[0].name :
      `${lowStock.length} items`;

  return sendOwnerPush(
    businessId,
    {
      title: "Restock needed",
      body: `${label} at or below minimum — open Inventory to reorder.`,
      deepLink: "/inventory",
      type: "low_stock",
    },
    "lowStockPushLastSentDate",
    now,
    uiConfig,
  );
}

/** NT-10 — subscription lifecycle push (expiring / expired).
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<PushResult>} Send outcome.
 */
export async function sendSubscriptionLifecyclePushForBusiness(
  businessId: string,
  now = new Date(),
): Promise<PushResult> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.subscriptionPushEnabled !== true) return { sent: false };
  if (!usesDormantPushHour(uiConfig, now)) return { sent: false };

  const lifecycle = await buildSubscriptionLifecycleSnapshot(businessId, now);
  if (!lifecycle.active || !lifecycle.headline) return { sent: false };

  const lastSent =
    typeof data.subscriptionPushLastSentDate === "string" ?
      data.subscriptionPushLastSentDate :
      undefined;
  if (lastSent === manilaDateKey(now)) return { sent: false };

  const title =
    lifecycle.phase === "expired" ?
      "Subscription expired" :
      lifecycle.phase === "expiring_1d" ?
        "Plan expires tomorrow" :
        "Plan expiring soon";

  return sendOwnerPush(
    businessId,
    {
      title,
      body: lifecycle.headline,
      deepLink: "/account?tab=subscription",
      type: "subscription_lifecycle",
    },
    "subscriptionPushLastSentDate",
    now,
    uiConfig,
  );
}

/** NT-74 — optional instant low-stock FCM when inventory drops below minimum. */
export async function maybeSendLowStockInstantPush(
  businessId: string,
  itemName: string,
  currentStock: number,
  unit: string,
): Promise<void> {
  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) return;

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  if (uiConfig.lowStockPushEnabled !== true) return;

  const today = manilaDateKey(new Date());
  const lastInstant =
    typeof data.lowStockInstantPushLastSentDate === "string" ?
      data.lowStockInstantPushLastSentDate :
      undefined;
  if (lastInstant === today) return;

  await sendOwnerPush(
    businessId,
    {
      title: "Restock needed",
      body: `${itemName} is at ${currentStock} ${unit} — below minimum.`,
      deepLink: "/inventory",
      type: "low_stock",
    },
    "lowStockInstantPushLastSentDate",
    new Date(),
    uiConfig,
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
  sla: boolean;
  containerDeficit: boolean;
  atRisk: boolean;
  lowStock: boolean;
  subscription: boolean;
}> {
  const [
    payment,
    maintenance,
    variance,
    reorder,
    sla,
    containerDeficit,
    atRisk,
    lowStock,
    subscription,
  ] = await Promise.all([
    sendPaymentReminderPushForBusiness(businessId, now),
    sendMaintenanceOverduePushForBusiness(businessId, now),
    sendProductionVariancePushForBusiness(businessId, now),
    sendInventoryReorderPushForBusiness(businessId, now),
    sendSlaBreachPushForBusiness(businessId, now),
    sendContainerDeficitPushForBusiness(businessId, now),
    sendAtRiskDeliveryPushForBusiness(businessId, now),
    sendLowStockPushForBusiness(businessId, now),
    sendSubscriptionLifecyclePushForBusiness(businessId, now),
  ]);
  return {
    payment: payment.sent,
    maintenance: maintenance.sent,
    variance: variance.sent,
    reorder: reorder.sent,
    sla: sla.sent,
    containerDeficit: containerDeficit.sent,
    atRisk: atRisk.sent,
    lowStock: lowStock.sent,
    subscription: subscription.sent,
  };
}
