/**
 * Canonical `limitations` patches for `subscription_plans` documents.
 * Matched by plan `code` (and Grow alias `pro`). Sync via `npm run sync:subscription-plans`.
 *
 * River AI quotas and human agent access live under `limitations.support` only.
 */
export const SUBSCRIPTION_PLAN_LIMITATION_PATCHES: Record<
  string,
  Record<string, unknown>
> = {
  starter: {
    customers: { max: 20 },
    transactions: { frequency: "daily", max: 20 },
    aiTools: { max: 5, frequency: "monthly" },
    online_orders: { frequency: "daily", max: 5 },
    channels: {
      messenger: { max: 0, frequency: "monthly" },
      whatsapp: { max: 0, frequency: "monthly" },
      sms: { max: 0, frequency: "monthly" },
      webhooks: { max: 0, frequency: "monthly" },
    },
    staff: { admin: 0, rider: 0 },
    support: {
      chat: { max: 5, frequency: "monthly" },
      attachments: false,
      agentChat: false,
    },
  },
  grow: {
    customers: { max: 200 },
    transactions: { frequency: "daily", max: 100 },
    aiTools: { max: 20, frequency: "monthly" },
    online_orders: { frequency: "daily", max: 25 },
    channels: {
      messenger: { max: 25, frequency: "monthly" },
      whatsapp: { max: 25, frequency: "monthly" },
      sms: { max: 50, frequency: "monthly" },
      webhooks: { max: 500, frequency: "monthly" },
    },
    staff: { admin: 0, rider: 1 },
    support: {
      chat: { max: 10, frequency: "monthly" },
      attachments: true,
      agentChat: true,
    },
  },
  pro: {
    customers: { max: 200 },
    transactions: { frequency: "daily", max: 100 },
    aiTools: { max: 20, frequency: "monthly" },
    online_orders: { frequency: "daily", max: 25 },
    channels: {
      messenger: { max: 25, frequency: "monthly" },
      whatsapp: { max: 25, frequency: "monthly" },
      sms: { max: 50, frequency: "monthly" },
      webhooks: { max: 500, frequency: "monthly" },
    },
    staff: { admin: 0, rider: 1 },
    support: {
      chat: { max: 10, frequency: "monthly" },
      attachments: true,
      agentChat: true,
    },
  },
  scale: {
    customers: "full",
    transactions: "full",
    aiTools: "full",
    online_orders: "full",
    channels: "full",
    staff: { admin: 1, rider: 2 },
    support: {
      chat: "full",
      attachments: true,
      agentChat: true,
      trial: {
        chat: { max: 50, frequency: "daily" },
        attachments: { enabled: true, max: 50, frequency: "daily" },
        agentChat: true,
      },
    },
  },
  enterprise: {
    customers: "full",
    transactions: "full",
    aiTools: "full",
    online_orders: "full",
    channels: "full",
    support: {
      chat: "full",
      attachments: true,
      agentChat: true,
    },
  },
};

/** Plan codes to attempt when syncing (covers docs located only by `code`). */
export const SUBSCRIPTION_PLAN_SYNC_CODES = [
  "starter",
  "grow",
  "pro",
  "scale",
  "enterprise",
] as const;

/** Legacy keys removed when syncing catalog patches. */
export const SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS = [
  "supportAi",
  "supportAiTrial",
] as const;
