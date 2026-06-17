/** BL-10 / BL-39 — sanitize notification keys on `businesses.uiConfig`. */

export const DORMANT_PUSH_HOUR_OPTIONS = [5, 6, 7, 8, 9, 10] as const;

const NOTIFICATION_KEYS = new Set([
  "dormantPushEnabled",
  "dormantPushHour",
  "dormantEmailDigestEnabled",
  "autoMorningBriefEnabled",
  "newOrderPushEnabled",
  "paymentReminderEnabled",
  "paymentReminderPushEnabled",
  "paymentReminder30Enabled",
  "paymentReminder60Enabled",
  "paymentReminder90Enabled",
  "maintenancePushEnabled",
  "productionVariancePushEnabled",
  "reorderPushEnabled",
  "reorderAlertDaysAhead",
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
    autoMorningBriefEnabled: cfg.autoMorningBriefEnabled === true,
    newOrderPushEnabled: cfg.newOrderPushEnabled !== false,
    paymentReminderEnabled: cfg.paymentReminderEnabled === true,
    paymentReminderPushEnabled: cfg.paymentReminderPushEnabled === true,
    paymentReminder30Enabled: cfg.paymentReminder30Enabled !== false,
    paymentReminder60Enabled: cfg.paymentReminder60Enabled !== false,
    paymentReminder90Enabled: cfg.paymentReminder90Enabled !== false,
    maintenancePushEnabled: cfg.maintenancePushEnabled === true,
    productionVariancePushEnabled: cfg.productionVariancePushEnabled === true,
    reorderPushEnabled: cfg.reorderPushEnabled === true,
  };
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
    prefs.dormantEmailDigestEnabled === true
  );
}
