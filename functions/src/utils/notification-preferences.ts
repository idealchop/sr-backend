/** BL-10 / BL-39 — sanitize notification keys on `businesses.uiConfig`. */

export const DORMANT_PUSH_HOUR_OPTIONS = [5, 6, 7, 8, 9, 10] as const;

const NOTIFICATION_KEYS = new Set([
  "dormantPushEnabled",
  "dormantPushHour",
  "dormantEmailDigestEnabled",
  "dormantEmailFrequency",
  "autoMorningBriefEnabled",
  "autoCollectionsPulseEnabled",
  "newOrderPushEnabled",
  "incomingRequestReminderPushEnabled",
  "paymentReminderEnabled",
  "paymentReminderPushEnabled",
  "paymentReminder30Enabled",
  "paymentReminder60Enabled",
  "paymentReminder90Enabled",
  "maintenancePushEnabled",
  "maintenanceOverdueEmailEnabled",
  "productionVariancePushEnabled",
  "reorderPushEnabled",
  "reorderAlertDaysAhead",
  "morningBriefEmailEnabled",
  "paymentReminderEmailEnabled",
  "slaBreachPushEnabled",
  "portalStatusEmailsEnabled",
  "containerDeficitPushEnabled",
  "atRiskDeliveryPushEnabled",
  "lowStockPushEnabled",
  "subscriptionPushEnabled",
  "weeklyPerformanceEmailEnabled",
  "subscriptionEmailEnabled",
  "productionVarianceEmailEnabled",
  "lowStockEmailEnabled",
  "teamDigestEmailEnabled",
  "quietHoursStart",
  "quietHoursEnd",
]);

export function mergeUiConfigPatch(
  oldConfig: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const notificationPatch = sanitizeNotificationUiConfigPatch(incoming);
  const rest = { ...incoming };
  for (const key of NOTIFICATION_KEYS) {
    delete rest[key];
  }
  return { ...oldConfig, ...rest, ...notificationPatch };
}

function readBoolean(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function readPushHour(raw: unknown): number | undefined {
  const n = Number(raw);
  if ((DORMANT_PUSH_HOUR_OPTIONS as readonly number[]).includes(n)) {
    return n;
  }
  return undefined;
}

/** Coerce known notification preference keys when present in a uiConfig patch.
 * @param {Record<string, unknown>} incoming Partial uiConfig patch.
 * @return {Record<string, unknown>} Sanitized notification keys only.
 */
export function sanitizeNotificationUiConfigPatch(
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (!NOTIFICATION_KEYS.has(key)) continue;

    if (key === "dormantPushHour") {
      const hour = readPushHour(value);
      if (hour !== undefined) out[key] = hour;
      continue;
    }

    if (key === "reorderAlertDaysAhead") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 1 && n <= 14) out[key] = Math.round(n);
      continue;
    }

    if (key === "quietHoursStart" || key === "quietHoursEnd") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 23) out[key] = Math.round(n);
      continue;
    }

    if (key === "dormantEmailFrequency") {
      const freq = String(value);
      if (freq === "daily" || freq === "weekly") out[key] = freq;
      continue;
    }

    const bool = readBoolean(value);
    if (bool !== undefined) out[key] = bool;
  }

  return out;
}

export function resolveNotificationPreferencesFromUiConfig(
  uiConfig?: Record<string, unknown> | null,
): Record<string, unknown> {
  const cfg = uiConfig ?? {};
  return {
    dormantPushEnabled: cfg.dormantPushEnabled === true,
    dormantPushHour: readPushHour(cfg.dormantPushHour) ?? 7,
    dormantEmailDigestEnabled: cfg.dormantEmailDigestEnabled === true,
    dormantEmailFrequency:
      cfg.dormantEmailFrequency === "daily" ? "daily" : "weekly",
    autoMorningBriefEnabled: cfg.autoMorningBriefEnabled === true,
    autoCollectionsPulseEnabled: cfg.autoCollectionsPulseEnabled === true,
    newOrderPushEnabled: cfg.newOrderPushEnabled !== false,
    incomingRequestReminderPushEnabled:
      cfg.incomingRequestReminderPushEnabled === true,
    paymentReminderEnabled: cfg.paymentReminderEnabled === true,
    paymentReminderPushEnabled: cfg.paymentReminderPushEnabled === true,
    paymentReminder30Enabled: cfg.paymentReminder30Enabled !== false,
    paymentReminder60Enabled: cfg.paymentReminder60Enabled !== false,
    paymentReminder90Enabled: cfg.paymentReminder90Enabled !== false,
    maintenancePushEnabled: cfg.maintenancePushEnabled === true,
    maintenanceOverdueEmailEnabled: cfg.maintenanceOverdueEmailEnabled === true,
    productionVariancePushEnabled: cfg.productionVariancePushEnabled === true,
    reorderPushEnabled: cfg.reorderPushEnabled === true,
    morningBriefEmailEnabled: cfg.morningBriefEmailEnabled === true,
    paymentReminderEmailEnabled: cfg.paymentReminderEmailEnabled === true,
    slaBreachPushEnabled: cfg.slaBreachPushEnabled === true,
    portalStatusEmailsEnabled: cfg.portalStatusEmailsEnabled !== false,
    containerDeficitPushEnabled: cfg.containerDeficitPushEnabled === true,
    atRiskDeliveryPushEnabled: cfg.atRiskDeliveryPushEnabled === true,
    lowStockPushEnabled: cfg.lowStockPushEnabled === true,
    subscriptionPushEnabled: cfg.subscriptionPushEnabled === true,
    weeklyPerformanceEmailEnabled: cfg.weeklyPerformanceEmailEnabled === true,
    subscriptionEmailEnabled: cfg.subscriptionEmailEnabled === true,
    productionVarianceEmailEnabled: cfg.productionVarianceEmailEnabled === true,
    lowStockEmailEnabled: cfg.lowStockEmailEnabled === true,
    teamDigestEmailEnabled: cfg.teamDigestEmailEnabled === true,
    quietHoursStart: readQuietHour(cfg.quietHoursStart),
    quietHoursEnd: readQuietHour(cfg.quietHoursEnd),
  };
}

function readQuietHour(raw: unknown): number | undefined {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 23) return Math.round(n);
  return undefined;
}

/** NT-71 — optional Manila quiet window (e.g. 22 → 6 blocks 10 PM–6 AM). */
export function resolveQuietHoursFromUiConfig(
  uiConfig?: Record<string, unknown> | null,
): { start?: number; end?: number } {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  const start = prefs.quietHoursStart as number | undefined;
  const end = prefs.quietHoursEnd as number | undefined;
  if (start == null || end == null) return {};
  return { start, end };
}

/** Denormalized flag for scheduled morning email / AI brief jobs (BL-07, BL-16).
 * @param {Record<string, unknown>|null|undefined} uiConfig Business uiConfig.
 * @return {boolean} Whether morning alert jobs should run.
 */
export function resolveOwnerMorningAlertsEnabled(
  uiConfig?: Record<string, unknown> | null,
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  return (
    prefs.autoMorningBriefEnabled === true ||
    prefs.dormantEmailDigestEnabled === true ||
    prefs.morningBriefEmailEnabled === true ||
    prefs.paymentReminderEmailEnabled === true ||
    prefs.maintenanceOverdueEmailEnabled === true ||
    prefs.autoCollectionsPulseEnabled === true ||
    prefs.weeklyPerformanceEmailEnabled === true ||
    prefs.subscriptionEmailEnabled === true ||
    prefs.productionVarianceEmailEnabled === true ||
    prefs.lowStockEmailEnabled === true ||
    prefs.teamDigestEmailEnabled === true
  );
}
