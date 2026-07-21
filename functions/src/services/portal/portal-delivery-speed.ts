/** Portal delivery speed + rider tip helpers for advance/balance payment. */

export type PortalDeliverySpeed = "priority" | "express" | "standard";

const SPEED_FEE_CAPS: Record<PortalDeliverySpeed, number> = {
  priority: 79,
  express: 37,
  standard: 0,
};

/**
 * Normalize portal delivery speed id (supports legacy `saver` → express).
 * @param {unknown} value
 * @return {PortalDeliverySpeed | null}
 */
export function normalizePortalDeliverySpeed(
  value: unknown,
): PortalDeliverySpeed | null {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (s === "priority" || s === "express" || s === "standard") return s;
  if (s === "saver") return "express";
  return null;
}

/**
 * Clamp a money amount to a non-negative finite number (max optional).
 * @param {unknown} value
 * @param {number} [max]
 * @return {number}
 */
export function clampPortalMoney(value: unknown, max = 50_000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(max, Math.round(n * 100) / 100);
}

/**
 * Resolve tip + delivery speed extras from a portal payment payload.
 * Tip is rider-only (not station commission). Speed fee is station revenue.
 * @param {Record<string, unknown> | null | undefined} payload
 * @return {{ deliverySpeed: PortalDeliverySpeed, deliverySpeedFee: number, riderTipAmount: number }}
 */
export function resolvePortalPaymentExtras(payload: {
  deliverySpeed?: unknown;
  deliverySpeedFee?: unknown;
  riderTipAmount?: unknown;
} | null | undefined): {
  deliverySpeed: PortalDeliverySpeed;
  deliverySpeedFee: number;
  riderTipAmount: number;
} {
  const deliverySpeed =
    normalizePortalDeliverySpeed(payload?.deliverySpeed) || "standard";
  const expectedFee = SPEED_FEE_CAPS[deliverySpeed];
  const rawFee = clampPortalMoney(payload?.deliverySpeedFee, expectedFee || 200);
  const deliverySpeedFee =
    deliverySpeed === "standard" ? 0 :
      rawFee > 0 ? Math.min(rawFee, expectedFee) :
      expectedFee;
  const riderTipAmount = clampPortalMoney(payload?.riderTipAmount, 500);
  return { deliverySpeed, deliverySpeedFee, riderTipAmount };
}
