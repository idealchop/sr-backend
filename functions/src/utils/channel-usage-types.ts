import type { PlanLimitFrequency } from "./subscription-addon-plan-limits";

export type ChannelUsageMetric =
  | "messengerConversations"
  | "whatsappConversations"
  | "smsSegments"
  | "webhookCalls";

export type ChannelUsageCounters = Record<ChannelUsageMetric, number>;

export type ChannelUsageDoc = ChannelUsageCounters & {
  periodKey: string;
  updatedAt?: unknown;
};

export type ChannelMeterKey = "messenger" | "whatsapp" | "sms" | "webhooks";

export type ChannelMeterQuota = {
  max: number | null;
  frequency: PlanLimitFrequency;
};

export type ChannelUsageQuotas = Record<ChannelMeterKey, ChannelMeterQuota | null>;

export const CHANNEL_METRIC_BY_METER: Record<ChannelMeterKey, ChannelUsageMetric> = {
  messenger: "messengerConversations",
  whatsapp: "whatsappConversations",
  sms: "smsSegments",
  webhooks: "webhookCalls",
};

export const EMPTY_CHANNEL_COUNTERS: ChannelUsageCounters = {
  messengerConversations: 0,
  whatsappConversations: 0,
  smsSegments: 0,
  webhookCalls: 0,
};
