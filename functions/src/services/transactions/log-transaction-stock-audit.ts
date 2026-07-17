import { logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import type { StockDeltaApplyResult } from "../inventory/inventory-service";

export async function logTransactionStockAuditRows(
  businessId: string,
  rows: StockDeltaApplyResult[],
  opts: {
    transactionId: string;
    referenceId?: string;
    customerId?: string;
    customerName?: string;
    auditType: "transaction_create" | "transaction_update";
    transactionType?: string;
    userId?: string;
    userName?: string;
  },
): Promise<void> {
  const actor = buildAuditActorFields(opts.userId, opts.userName);
  for (const row of rows) {
    if (!row.netDelta) continue;
    await logAuditEvent(
      "INVENTORY_ADJUSTED",
      {
        businessId,
        itemId: row.itemId,
        itemName: row.name,
        adjustment: row.netDelta,
        transactionId: opts.transactionId,
        referenceId: opts.referenceId,
        customerId: opts.customerId,
        customerName: opts.customerName,
        type: opts.auditType,
        transactionType: opts.transactionType,
        ...actor,
      },
      { currentStock: row.previousStock },
      { currentStock: row.newStock },
      opts.transactionId,
    );
  }
}
