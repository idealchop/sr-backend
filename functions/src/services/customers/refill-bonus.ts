/**
 * Per-suki refill promo — flexible (free per order) or fixed (pay X get Y).
 */

export type RefillBonusMode = "flexible" | "fixed";

export type RefillBonusConfig = {
  enabled: boolean;
  mode: RefillBonusMode;
  freePerOrder?: number;
  buyQty?: number;
  getQty?: number;
};

function resolveMode(bonus: Partial<RefillBonusConfig>): RefillBonusMode {
  if (bonus.mode === "flexible" || bonus.mode === "fixed") return bonus.mode;
  const buy = Math.floor(Number(bonus.buyQty) || 0);
  const get = Math.floor(Number(bonus.getQty) || 0);
  if (buy >= 1 && get > buy) return "fixed";
  return "flexible";
}

export function normalizeRefillBonus(
  bonus: Partial<RefillBonusConfig> | null | undefined,
): RefillBonusConfig | null {
  if (!bonus || bonus.enabled !== true) return null;
  const mode = resolveMode(bonus);

  if (mode === "flexible") {
    const freePerOrder = Math.max(0, Math.floor(Number(bonus.freePerOrder) || 0));
    return { enabled: true, mode: "flexible", freePerOrder };
  }

  const buyQty = Math.max(1, Math.floor(Number(bonus.buyQty) || 0));
  const getQty = Math.floor(Number(bonus.getQty) || 0);
  if (!(buyQty >= 1) || !(getQty > buyQty)) return null;
  return { enabled: true, mode: "fixed", buyQty, getQty };
}

export function applyRefillBonus(
  paidQty: number,
  bonus: RefillBonusConfig | null | undefined,
): { paidQty: number; deliveredQty: number; freeQty: number } {
  const paid = Math.max(0, Math.floor(Number(paidQty) || 0));
  const normalized = normalizeRefillBonus(bonus);
  if (!normalized || paid <= 0) {
    return { paidQty: paid, deliveredQty: paid, freeQty: 0 };
  }

  if (normalized.mode === "flexible") {
    const freeQty = Math.max(0, Math.floor(Number(normalized.freePerOrder) || 0));
    return { paidQty: paid, deliveredQty: paid + freeQty, freeQty };
  }

  const buyQty = normalized.buyQty || 0;
  const getQty = normalized.getQty || 0;
  const sets = Math.floor(paid / buyQty);
  const freeQty = sets * (getQty - buyQty);
  return { paidQty: paid, deliveredQty: paid + freeQty, freeQty };
}
