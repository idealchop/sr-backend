import { logger } from "../observability/logging/logger";
import { TransactionService } from "../transactions/transaction-service";
import type { ExtractedCustomerHistoryRow } from "./customer-history-import-from-file-service";

function mapPaymentMethod(
  m?: string,
): "cash" | "digital_wallet" | "bank_transfer" | "other" {
  if (m === "Online Payment") return "digital_wallet";
  if (m === "Cash") return "cash";
  return "cash";
}

function resolvePayment(
  row: ExtractedCustomerHistoryRow,
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
  return { amountPaid: 0, paymentStatus: totalAmount > 0 ? "unpaid" : "paid" };
}

export class CustomerHistoryImportCommitService {
  static async commitExtracted(params: {
    businessId: string;
    userId: string;
    customerId: string;
    customerName: string;
    rows: ExtractedCustomerHistoryRow[];
    defaultWaterTypeId: string;
    defaultWaterName: string;
    defaultUnitPrice: number;
  }): Promise<{ created: number; errors: string[] }> {
    const {
      businessId,
      userId,
      customerId,
      customerName,
      rows,
      defaultWaterTypeId,
      defaultWaterName,
      defaultUnitPrice,
    } = params;

    let created = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (row.transactionType === "collection") continue;

      try {
        if (row.transactionType === "expense") {
          const total = Number(row.amount) || 0;
          if (total <= 0) continue;
          const pay = resolvePayment(row, total);
          await TransactionService.addTransaction(
            businessId,
            {
              type: "expense",
              customerName: row.notes?.slice(0, 60) || "Expense",
              totalAmount: total,
              amountPaid: pay.amountPaid,
              paymentStatus: pay.paymentStatus,
              paymentMethod: mapPaymentMethod(row.paymentMethod),
              expenseCategory:
                (row.notes && row.notes.length < 80 ? row.notes : null) ||
                "General",
              notes: row.notes,
              scheduledAt: row.date,
              deliveryStatus: "delivered",
            },
            userId,
          );
          created++;
          continue;
        }

        const qty = Math.max(0, Math.round(Number(row.bottleQuantity) || 0));
        const amount =
          row.amount && Number(row.amount) > 0 ?
            Number(row.amount) :
            qty * defaultUnitPrice;
        if (qty <= 0 && amount <= 0) continue;

        const lineQty = qty > 0 ? qty : 1;
        const pay = resolvePayment(row, amount);
        const deliveryStatus =
          row.deliveryStatus === "pending" ? "pending" : "delivered";
        const txType = row.transactionType === "walkin" ? "walkin" : "delivery";

        const waterRefills = [
          {
            waterTypeId: defaultWaterTypeId,
            name: defaultWaterName,
            quantity: lineQty,
            unitPrice: lineQty > 0 ? amount / lineQty : defaultUnitPrice,
            subtotal: amount,
          },
        ];

        await TransactionService.addTransaction(
          businessId,
          {
            type: txType,
            customerId,
            customerName,
            waterRefills,
            totalAmount: amount,
            amountPaid: pay.amountPaid,
            paymentStatus: pay.paymentStatus,
            paymentMethod: mapPaymentMethod(row.paymentMethod),
            notes: row.notes,
            scheduledAt: row.date,
            deliveryStatus,
          },
          userId,
        );
        created++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("customer_history_import_commit_row_failed", { msg, row });
        errors.push(msg);
      }
    }

    return { created, errors };
  }
}
