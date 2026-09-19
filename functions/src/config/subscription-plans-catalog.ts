/**
 * Canonical `limitations` patches for `subscription_plans` documents.
 * Matched by plan `code` (and Grow alias `pro`). Sync via `npm run sync:subscription-plans`.
 *
 * River AI quotas and human agent access live under `limitations.support` only.
 */

const CHANNELS_DISABLED = {
  messenger: { max: 0, frequency: "monthly" },
  whatsapp: { max: 0, frequency: "monthly" },
  sms: { max: 0, frequency: "monthly" },
  webhooks: { max: 0, frequency: "monthly" },
} as const;

const SUPPORT_CHAT_ONLY = {
  chat: { max: 0, frequency: "monthly" },
  attachments: false,
  agentChat: true,
} as const;

export const SUBSCRIPTION_PLAN_CATALOG_ROWS: Record<
  string,
  {
    code: string;
    name: string;
    pricing: { monthly: number; yearly: number };
    limitations: Record<string, unknown>;
  }
> = {
  free: {
    code: "free",
    name: "Free",
    pricing: { monthly: 0, yearly: 0 },
    limitations: {
      customers: { max: 100 },
      containers: { frequency: "daily", max: 50 },
      transactions: { frequency: "daily", max: 50 },
      aiTools: { max: 0, frequency: "monthly" },
      online_orders: { frequency: "daily", max: 0 },
      channels: CHANNELS_DISABLED,
      staff: { admin: 0, rider: 0 },
      support: SUPPORT_CHAT_ONLY,
    },
  },
  starter: {
    code: "starter",
    name: "Starter",
    pricing: { monthly: 399, yearly: 3990 },
    limitations: {
      customers: "full",
      containers: { frequency: "daily", max: 150 },
      transactions: { frequency: "daily", max: 150 },
      aiTools: { max: 0, frequency: "monthly" },
      online_orders: { frequency: "daily", max: 10 },
      channels: CHANNELS_DISABLED,
      staff: { admin: 0, rider: 0 },
      support: SUPPORT_CHAT_ONLY,
    },
  },
  grow: {
    code: "grow",
    name: "Grow",
    pricing: { monthly: 950, yearly: 9500 },
    limitations: {
      customers: "full",
      containers: { frequency: "daily", max: 350 },
      transactions: { frequency: "daily", max: 350 },
      aiTools: { max: 0, frequency: "monthly" },
      online_orders: { frequency: "daily", max: 25 },
      channels: CHANNELS_DISABLED,
      staff: { admin: 0, rider: 1 },
      support: SUPPORT_CHAT_ONLY,
    },
  },
  pro: {
    code: "pro",
    name: "Grow",
    pricing: { monthly: 950, yearly: 9500 },
    limitations: {
      customers: "full",
      containers: { frequency: "daily", max: 350 },
      transactions: { frequency: "daily", max: 350 },
      aiTools: { max: 0, frequency: "monthly" },
      online_orders: { frequency: "daily", max: 25 },
      channels: CHANNELS_DISABLED,
      staff: { admin: 0, rider: 1 },
      support: SUPPORT_CHAT_ONLY,
    },
  },
  scale: {
    code: "scale",
    name: "Scale",
    pricing: { monthly: 1650, yearly: 16500 },
    limitations: {
      customers: "full",
      containers: "full",
      transactions: "full",
      aiTools: "full",
      online_orders: "full",
      channels: CHANNELS_DISABLED,
      staff: { admin: 1, rider: 2 },
      support: {
        chat: "full",
        attachments: true,
        agentChat: true,
        trial: {
          chat: { max: 5, frequency: "daily" },
          attachments: { enabled: true, max: 5, frequency: "daily" },
          agentChat: true,
        },
      },
    },
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    pricing: { monthly: 0, yearly: 0 },
    limitations: {
      customers: "full",
      containers: "full",
      transactions: "full",
      aiTools: "full",
      online_orders: "full",
      channels: CHANNELS_DISABLED,
      support: {
        chat: "full",
        attachments: true,
        agentChat: true,
      },
    },
  },
};

export const SUBSCRIPTION_PLAN_LIMITATION_PATCHES: Record<
  string,
  Record<string, unknown>
> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_PLAN_CATALOG_ROWS).map(([code, row]) => [
    code,
    row.limitations,
  ]),
);

/** Plan codes to attempt when syncing (covers docs located only by `code`). */
export const SUBSCRIPTION_PLAN_SYNC_CODES = [
  "free",
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
