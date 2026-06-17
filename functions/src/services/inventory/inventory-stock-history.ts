import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { isStockTrackedInventoryId } from "../transactions/transaction-line-inventory";
import {
  InventoryService,
  type InventoryAssignment,
} from "./inventory-service";

export type StockHistoryRow = {
  id: string;
  timestamp: string;
  adjustment: number;
  previousStock?: number;
  newStock?: number;
  customerName?: string;
  detail?: string;
  transactionId?: string;
  referenceId?: string;
};

const CUSTOMER_REASON_LABELS: Record<string, string> = {
  CUSTOMER_ONBOARDING_WRS_ASSIGNMENT: "Assigned to customer (new customer)",
  CUSTOMER_POSSESSION_UPDATE: "Customer containers updated",
  CUSTOMER_DELETED_STOCK_RESTORATION: "Returned to warehouse (customer removed)",
  MANUAL_RESTOCK: "Manual stock adjustment",
};

const TRANSACTION_STOCK_LABELS: Record<string, string> = {
  transaction_create: "Recorded from transaction",
  transaction_update: "Transaction updated",
  void_reversal: "Transaction voided (stock restored)",
};

const COLLECTION_STOCK_PHASES = new Set([
  "delivered",
  "completed",
  "collected",
]);

const INVENTORY_AUDIT_EVENTS = new Set([
  "INVENTORY_ADJUSTED",
  "INVENTORY_STOCK_ADJUSTED",
]);

/**
 * @param {unknown} value Firestore Timestamp or JSON timestamp.
 * @return {string | null} ISO timestamp or null when missing.
 */
export function serializeFirestoreTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof (record as { toDate?: () => Date }).toDate === "function") {
      return (record as { toDate: () => Date }).toDate().toISOString();
    }
    const seconds =
      typeof record.seconds === "number" ?
        record.seconds :
        typeof record._seconds === "number" ?
          record._seconds :
          null;
    if (seconds !== null) {
      const nanos =
        typeof record.nanoseconds === "number" ?
          record.nanoseconds :
          typeof record._nanoseconds === "number" ?
            record._nanoseconds :
            0;
      return new Date(seconds * 1000 + nanos / 1e6).toISOString();
    }
  }
  return null;
}

function readAuditAdjustment(data: Record<string, unknown>): number {
  return Number(data.adjustment) || 0;
}

function readAuditStocks(data: Record<string, unknown>, adjustment: number) {
  const oldValue = data.oldValue as { currentStock?: number } | undefined;
  const newValue = data.newValue as { currentStock?: number } | undefined;
  const metadata = data.metadata as
    | { previousStock?: number; newStock?: number }
    | undefined;
  const newStockRaw =
    newValue?.currentStock ?? data.newStock ?? metadata?.newStock;
  const previousStockRaw =
    oldValue?.currentStock ?? data.previousStock ?? metadata?.previousStock;

  const newStock = Number(newStockRaw);
  const previousStock = Number(previousStockRaw);

  const resolvedNew = Number.isFinite(newStock) ? newStock : undefined;
  let resolvedPrevious = Number.isFinite(previousStock) ?
    previousStock :
    undefined;
  if (
    resolvedPrevious === undefined &&
    resolvedNew !== undefined &&
    adjustment !== 0
  ) {
    resolvedPrevious = resolvedNew - adjustment;
  }

  return { previousStock: resolvedPrevious, newStock: resolvedNew };
}

function mapAuditDoc(doc: QueryDocumentSnapshot): StockHistoryRow | null {
  const data = doc.data() as Record<string, unknown>;
  const event = String(data.event || "");
  const message = String(data.message || "");
  const isInventoryEvent =
    INVENTORY_AUDIT_EVENTS.has(event) ||
    message.includes("INVENTORY_ADJUSTED") ||
    message.includes("INVENTORY_STOCK_ADJUSTED");

  if (!isInventoryEvent) return null;

  const adjustment = readAuditAdjustment(data);
  if (!adjustment) return null;

  const timestamp = serializeFirestoreTimestamp(data.timestamp);
  if (!timestamp) return null;

  const { previousStock, newStock } = readAuditStocks(data, adjustment);

  return {
    id: `audit-${doc.id}`,
    timestamp,
    adjustment,
    previousStock,
    newStock,
    customerName:
      typeof data.customerName === "string" ? data.customerName : undefined,
    detail: resolveMovementDetail(data),
    transactionId:
      typeof data.transactionId === "string" ? data.transactionId : undefined,
    referenceId:
      typeof data.referenceId === "string" ? data.referenceId : undefined,
  };
}

function formatTransactionTypeLabel(txType: string): string | undefined {
  switch (txType) {
  case "direct_sale":
    return "Store sale";
  case "walkin":
    return "Walk-in sale";
  case "delivery":
    return "Delivery";
  case "collection":
    return "Collection return";
  default:
    return undefined;
  }
}

function resolveMovementDetail(data: Record<string, unknown>): string {
  const reason = String(data.reason || "").trim();
  if (reason && CUSTOMER_REASON_LABELS[reason]) {
    return CUSTOMER_REASON_LABELS[reason];
  }

  const contextType = String(data.type || "").trim();
  const txLabel = formatTransactionTypeLabel(
    String(data.transactionType || ""),
  );

  if (contextType && TRANSACTION_STOCK_LABELS[contextType]) {
    const base = TRANSACTION_STOCK_LABELS[contextType];
    return txLabel ? `${txLabel} · ${base}` : base;
  }

  if (txLabel) return txLabel;

  if (reason) return reason.replace(/_/g, " ").toLowerCase();
  return "Stock adjusted";
}

function transactionStockDetail(
  txType: string,
  referenceId?: string,
): string {
  const label = formatTransactionTypeLabel(txType) || "Transaction";
  return referenceId ? `${label} (${referenceId})` : label;
}

function mapAssignmentRow(
  assignment: InventoryAssignment,
): StockHistoryRow | null {
  const assignmentId = assignment.id;
  if (!assignmentId) return null;

  const qty = Number(assignment.quantityAssigned) || 0;
  if (!qty) return null;

  const timestamp = serializeFirestoreTimestamp(assignment.date);
  if (!timestamp) return null;

  return {
    id: `assignment-${assignmentId}`,
    timestamp,
    adjustment: -qty,
    customerName: assignment.customerName || undefined,
    detail:
      qty > 0 ? "Assigned to customer" : "Returned from customer",
  };
}

function dedupeKey(row: StockHistoryRow): string {
  if (row.transactionId) {
    return `${row.transactionId}|${row.adjustment}`;
  }
  const minute = row.timestamp.slice(0, 16);
  return `${minute}|${row.adjustment}|${row.customerName ?? ""}`;
}

async function listAuditRowsForItem(
  businessId: string,
  itemId: string,
  limit: number,
): Promise<StockHistoryRow[]> {
  const collection = db
    .collection("businesses")
    .doc(businessId)
    .collection("audit_logs");

  try {
    const snapshot = await collection
      .where("itemId", "==", itemId)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => mapAuditDoc(doc))
      .filter((row): row is StockHistoryRow => row !== null);
  } catch (error) {
    logger.warn("itemId audit index query failed; falling back to scan", {
      businessId,
      itemId,
      error,
    });

    const snapshot = await collection
      .orderBy("timestamp", "desc")
      .limit(Math.max(limit * 4, 120))
      .get();

    return snapshot.docs
      .filter((doc) => (doc.data() as { itemId?: string }).itemId === itemId)
      .map((doc) => mapAuditDoc(doc))
      .filter((row): row is StockHistoryRow => row !== null)
      .slice(0, limit);
  }
}

/**
 * Backfill rows from completed transactions when audit logs predate stock auditing.
 * @param {string} businessId Business ID.
 * @param {string} itemId Inventory item ID.
 * @param {number} limit Max rows to consider.
 * @return {Promise<StockHistoryRow[]>} Synthetic history rows.
 */
async function listTransactionStockRowsForItem(
  businessId: string,
  itemId: string,
  limit: number,
): Promise<StockHistoryRow[]> {
  try {
    const snapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .orderBy("createdAt", "desc")
      .limit(Math.min(Math.max(limit * 4, 40), 160))
      .get();

    const rows: StockHistoryRow[] = [];

    for (const doc of snapshot.docs) {
      const tx = doc.data() as Record<string, unknown>;
      const timestamp = serializeFirestoreTimestamp(
        tx.deliveredAt ?? tx.scheduledAt ?? tx.createdAt,
      );
      if (!timestamp) continue;

      const txType = String(tx.type || "");
      const referenceId =
        typeof tx.referenceId === "string" ? tx.referenceId : undefined;
      const customerName =
        typeof tx.customerName === "string" ? tx.customerName : undefined;
      const salesApplied = tx.salesStockApplied !== false;
      const deliveryStatus = String(tx.deliveryStatus || "");

      if (salesApplied) {
        const items = (tx.items as Array<Record<string, unknown>>) || [];
        for (const item of items) {
          const invId = String(item.inventoryId || item.itemId || "");
          if (!isStockTrackedInventoryId(invId) || invId !== itemId) continue;
          const qty = Number(item.quantity) || 0;
          if (qty <= 0) continue;
          rows.push({
            id: `tx-${doc.id}-sale-${qty}`,
            timestamp,
            adjustment: -qty,
            customerName,
            detail: transactionStockDetail(txType, referenceId),
            transactionId: doc.id,
            referenceId,
          });
        }
      }

      if (COLLECTION_STOCK_PHASES.has(deliveryStatus)) {
        const collectionItems =
          (tx.collectionItems as Array<Record<string, unknown>>) || [];
        for (const item of collectionItems) {
          const invId = String(item.inventoryId || "");
          if (invId !== itemId) continue;
          const units = Math.max(0, Number(item.qtyOk) || 0);
          if (units <= 0) continue;
          rows.push({
            id: `tx-${doc.id}-col-${units}`,
            timestamp,
            adjustment: units,
            customerName,
            detail: transactionStockDetail("collection", referenceId),
            transactionId: doc.id,
            referenceId,
          });
        }
      }

      if (rows.length >= limit) break;
    }

    return rows;
  } catch (error) {
    logger.warn("Failed to load transaction stock history fallback", {
      businessId,
      itemId,
      error,
    });
    return [];
  }
}

/**
 * Merged stock movement timeline for one inventory item (audits + customer assignments).
 * @param {string} businessId Business ID.
 * @param {string} itemId Inventory item ID.
 * @param {number} limit Max rows returned.
 * @return {Promise<StockHistoryRow[]>} Timeline rows newest first.
 */
export async function getInventoryItemStockHistory(
  businessId: string,
  itemId: string,
  limit = 50,
): Promise<StockHistoryRow[]> {
  const [auditRows, assignments, transactionRows] = await Promise.all([
    listAuditRowsForItem(businessId, itemId, limit),
    InventoryService.getItemAssignments(businessId, itemId, limit).catch(
      (error) => {
        logger.warn("Failed to load assignments for stock history", {
          businessId,
          itemId,
          error,
        });
        return [];
      },
    ),
    listTransactionStockRowsForItem(businessId, itemId, limit),
  ]);

  const seen = new Set(auditRows.map(dedupeKey));

  const assignmentRows = assignments
    .map((row) => mapAssignmentRow(row))
    .filter((row): row is StockHistoryRow => {
      if (!row) return false;
      const key = dedupeKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const backfillRows = transactionRows.filter((row) => {
    const key = dedupeKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...auditRows, ...assignmentRows, ...backfillRows]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, limit);
}
