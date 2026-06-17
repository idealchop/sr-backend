import { db, FieldValue } from "../../config/firebase-admin";
import { SubscriptionService } from "../subscriptions/subscription-service";
import {
  CHANNEL_METRIC_BY_METER,
  EMPTY_CHANNEL_COUNTERS,
  type ChannelMeterKey,
  type ChannelUsageCounters,
  type ChannelUsageDoc,
  type ChannelUsageMetric,
  type ChannelUsageQuotas,
} from "../../utils/channel-usage-types";
import {
  type ChannelUsageStatusSnapshot,
} from "../../utils/channel-usage-plan-limits";

const MANILA_TZ = "Asia/Manila";

export class ChannelUsageLimitError extends Error {
  code = "CHANNEL_USAGE_LIMIT_EXCEEDED";

  constructor(
    message: string,
    public readonly metric: ChannelUsageMetric,
    public readonly used: number,
    public readonly cap: number,
  ) {
    super(message);
    this.name = "ChannelUsageLimitError";
  }
}

function manilaPeriodKey(frequency: "daily" | "monthly", now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  if (frequency === "monthly") return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

function normalizeCounters(raw: Partial<ChannelUsageDoc> | undefined): ChannelUsageCounters {
  return {
    messengerConversations: Math.max(0, Number(raw?.messengerConversations) || 0),
    whatsappConversations: Math.max(0, Number(raw?.whatsappConversations) || 0),
    smsSegments: Math.max(0, Number(raw?.smsSegments) || 0),
    webhookCalls: Math.max(0, Number(raw?.webhookCalls) || 0),
  };
}

function meterKeyForMetric(metric: ChannelUsageMetric): ChannelMeterKey {
  const entry = Object.entries(CHANNEL_METRIC_BY_METER).find(([, m]) => m === metric);
  if (!entry) throw new Error(`Unknown channel metric: ${metric}`);
  return entry[0] as ChannelMeterKey;
}

export class ChannelUsageService {
  static async resolveQuotasForBusiness(
    businessId: string,
  ): Promise<ChannelUsageQuotas | null> {
    const quotas = await SubscriptionService.resolvePlanQuotasForBusiness(businessId);
    return quotas?.channelUsage ?? null;
  }

  static async readCounters(businessId: string): Promise<ChannelUsageCounters> {
    const snap = await db.collection("businesses").doc(businessId).get();
    const raw = snap.data()?.channelUsage as ChannelUsageDoc | undefined;
    const frequency = "monthly";
    const expectedKey = manilaPeriodKey(frequency);
    if (!raw || raw.periodKey !== expectedKey) {
      return { ...EMPTY_CHANNEL_COUNTERS };
    }
    return normalizeCounters(raw);
  }

  static async getStatusSnapshot(
    businessId: string,
  ): Promise<ChannelUsageStatusSnapshot> {
    const quotas = await this.resolveQuotasForBusiness(businessId);
    const counters = await this.readCounters(businessId);
    return buildChannelUsageStatusSnapshot(quotas, counters);
  }

  static async incrementUsage(
    businessId: string,
    metric: ChannelUsageMetric,
    amount = 1,
  ): Promise<ChannelUsageCounters> {
    const delta = Math.max(1, Math.floor(amount));
    const ref = db.collection("businesses").doc(businessId);
    const frequency = "monthly";
    const periodKey = manilaPeriodKey(frequency);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap.data()?.channelUsage as ChannelUsageDoc | undefined;
      const counters =
        raw?.periodKey === periodKey ? normalizeCounters(raw) : { ...EMPTY_CHANNEL_COUNTERS };
      counters[metric] += delta;
      tx.set(
        ref,
        {
          channelUsage: {
            ...counters,
            periodKey,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      return counters;
    });
  }

  static async assertWithinCap(
    businessId: string,
    metric: ChannelUsageMetric,
    amount = 1,
  ): Promise<void> {
    const meter = meterKeyForMetric(metric);
    const quotas = await this.resolveQuotasForBusiness(businessId);
    const quota = quotas?.[meter];
    if (!quota || quota.max === null) return;
    if (quota.max <= 0) {
      throw new ChannelUsageLimitError(
        "Messaging channels are not included on your plan — upgrade to enable " +
        "Messenger, WhatsApp, and SMS integrations.",
        metric,
        0,
        0,
      );
    }
    const counters = await this.readCounters(businessId);
    const used = counters[metric];
    if (used + amount > quota.max) {
      throw new ChannelUsageLimitError(
        `Channel quota reached for ${meter} (${quota.max}/${quota.frequency}). ` +
        "Upgrade your plan or wait for the window to reset.",
        metric,
        used,
        quota.max,
      );
    }
  }

  /**
   * Increment after a successful webhook send/receive once channel adapters ship (BL-25+).
   * @param {string} businessId Business id.
   * @param {ChannelUsageMetric} metric Channel meter to increment.
   * @param {number} amount Units to add (default 1).
   * @return {Promise<ChannelUsageCounters>} Updated counters for the current period.
   */
  static async recordUsage(
    businessId: string,
    metric: ChannelUsageMetric,
    amount = 1,
  ): Promise<ChannelUsageCounters> {
    await this.assertWithinCap(businessId, metric, amount);
    return this.incrementUsage(businessId, metric, amount);
  }
}

export function buildChannelUsageStatusSnapshot(
  quotas: ChannelUsageQuotas | null,
  counters: ChannelUsageCounters,
): ChannelUsageStatusSnapshot {
  const rows = (["messenger", "whatsapp", "sms", "webhooks"] as ChannelMeterKey[]).map(
    (key) => {
      const quota = quotas?.[key] ?? null;
      const metric = CHANNEL_METRIC_BY_METER[key];
      return {
        key,
        used: counters[metric],
        max: quota?.max ?? null,
        frequency: quota?.frequency ?? "monthly",
        enabled: quota !== null && (quota.max === null || quota.max > 0),
      };
    },
  );
  const channelsEnabled = rows.some((row) => row.enabled);
  return {
    frequency: "monthly" as const,
    channelsEnabled,
    rows,
    messengerUsed: counters.messengerConversations,
    messengerMax: quotas?.messenger?.max ?? null,
    whatsappUsed: counters.whatsappConversations,
    whatsappMax: quotas?.whatsapp?.max ?? null,
    smsUsed: counters.smsSegments,
    smsMax: quotas?.sms?.max ?? null,
    webhooksUsed: counters.webhookCalls,
    webhooksMax: quotas?.webhooks?.max ?? null,
  };
}
