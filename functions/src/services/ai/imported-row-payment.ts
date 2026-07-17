/**
 * Shared payment hint resolution for AI ledger scan + customer history import.
 * "partial" uses a half-paid heuristic when the source row has no amount.
 */

export type ImportedPaymentHints = {
  paymentStatus?: string;
  paymentMethod?: string;
  deliveryStatus?: string;
};

export function resolveImportedRowPayment(
  row: ImportedPaymentHints,
  totalAmount: number,
): { amountPaid: number; paymentStatus: "paid" | "partial" | "unpaid" } {
  if (row.paymentStatus === "paid") {
    return { amountPaid: totalAmount, paymentStatus: "paid" };
  }
  if (row.paymentStatus === "partial") {
    const half = Math.max(0, Math.round(totalAmount / 2));
    return { amountPaid: half, paymentStatus: "partial" };
  }
  if (row.paymentStatus === "unpaid" || row.paymentMethod === "Not Paid") {
    return { amountPaid: 0, paymentStatus: "unpaid" };
  }
  const delivered = row.deliveryStatus !== "pending";
  if (delivered && totalAmount > 0) {
    return { amountPaid: totalAmount, paymentStatus: "paid" };
  }
  return {
    amountPaid: 0,
    paymentStatus: totalAmount > 0 ? "unpaid" : "paid",
  };
}
