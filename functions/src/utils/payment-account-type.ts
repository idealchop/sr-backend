const PAYMENT_ACCOUNT_TYPES = new Set([
  "bank_transfer",
  "credit_card",
  "digital_wallet",
]);

export type PaymentAccountType =
  | "bank_transfer"
  | "credit_card"
  | "digital_wallet";

/**
 * Normalizes payment account type for storage and transaction pickers.
 * Legacy rows used "Bank"; wallet providers are inferred from bankName.
 * @param {unknown} raw Type from the client or existing document.
 * @param {unknown} bankName Provider label (e.g. GCash, BDO).
 * @return {string} Canonical account type.
 */
export const normalizePaymentAccountType = (
  raw: unknown,
  bankName?: unknown,
): PaymentAccountType => {
  const type = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (PAYMENT_ACCOUNT_TYPES.has(type)) {
    return type as PaymentAccountType;
  }
  if (type.includes("wallet")) return "digital_wallet";
  if (type.includes("card")) return "credit_card";

  const provider =
    typeof bankName === "string" ? bankName.trim().toLowerCase() : "";
  if (
    provider.includes("gcash") ||
    provider.includes("maya") ||
    provider.includes("paymaya")
  ) {
    return "digital_wallet";
  }
  return "bank_transfer";
};
