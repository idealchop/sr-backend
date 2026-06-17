import type { PlanLimitFrequency } from "./subscription-addon-plan-limits";
import {
  type ChannelMeterKey,
  type ChannelMeterQuota,
  type ChannelUsageQuotas,
} from "./channel-usage-types";

export type ChannelUsageStatusRow = {
  key: ChannelMeterKey;
  used: number;
  max: number | null;
  frequency: PlanLimitFrequency;
  enabled: boolean;
};

export type ChannelUsageStatusSnapshot = {
  frequency: PlanLimitFrequency;
  channelsEnabled: boolean;
  rows: ChannelUsageStatusRow[];
  messengerUsed: number;
  messengerMax: number | null;
  whatsappUsed: number;
  whatsappMax: number | null;
  smsUsed: number;
  smsMax: number | null;
  webhooksUsed: number;
  webhooksMax: number | null;
};

function finiteNonNegative(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function isUnlimitedMarker(v: unknown): boolean {
  return v === "full" || v === "unlimited";
}

function parseMeterQuota(raw: unknown): ChannelMeterQuota | null {
  if (raw === undefined || raw === null) return null;
  if (isUnlimitedMarker(raw)) {
    return { max: null, frequency: "monthly" };
  }
  if (typeof raw !== "object") return null;
  const row = raw as { max?: unknown; frequency?: unknown };
  const max = finiteNonNegative(row.max);
  if (max === null) return null;
  const freq = String(row.frequency || "monthly").toLowerCase();
  return {
    max,
    frequency: freq === "daily" ? "daily" : "monthly",
  };
}

/**
 * Parses `subscription_plans.limitations.channels`.
 * @param {unknown} channels Raw plan limitations.channels value.
 * @return {ChannelUsageQuotas|null} Parsed quotas or null when absent.
 */
export function parseChannelUsageQuotas(
  channels: unknown,
): ChannelUsageQuotas | null {
  if (channels === undefined || channels === null) return null;
  if (isUnlimitedMarker(channels)) {
    return {
      messenger: { max: null, frequency: "monthly" },
      whatsapp: { max: null, frequency: "monthly" },
      sms: { max: null, frequency: "monthly" },
      webhooks: { max: null, frequency: "monthly" },
    };
  }
  if (typeof channels !== "object") return null;
  const L = channels as Record<string, unknown>;
  return {
    messenger: parseMeterQuota(L.messenger ?? L.messengerConversations),
    whatsapp: parseMeterQuota(L.whatsapp ?? L.whatsappConversations),
    sms: parseMeterQuota(L.sms ?? L.smsSegments),
    webhooks: parseMeterQuota(L.webhooks ?? L.webhookCalls),
  };
}
