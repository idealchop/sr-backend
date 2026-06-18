import type { Customer } from "../services/customers/customer-service";
import type { Transaction } from "../services/transactions/transaction-service";

export const DEFAULT_CONTAINER_DEFICIT_LOOKBACK_DAYS = 90;
export const DEFAULT_CONTAINER_DEFICIT_MIN_QTY = 1;

export type ContainerDeficitRow = {
  customerId: string;
  customerName: string;
  totalDeficitQty: number;
  oldestDays: number;
  transactionCount: number;
};

export type ContainerDeficitSnapshot = {
  count: number;
  totalDeficitQty: number;
  rows: ContainerDeficitRow[];
};

const FULFILLED_DELIVERY_STATUSES = new Set(["delivered", "completed", "collected"]);

function parseTxDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return null;
}

function isFulfilledDelivery(tx: Transaction): boolean {
  if (tx.type !== "delivery") return false;
  const status = String(tx.deliveryStatus || "").toLowerCase();
  return FULFILLED_DELIVERY_STATUSES.has(status);
}

function openDeficitQtyOnTransaction(tx: Transaction): number {
  const items = tx.collectionItems ?? [];
  return items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.deficitQty) || 0),
    0,
  );
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/** BL-35 / NT-07 — sukis with open container deficit from recent deliveries. */
export function buildContainerDeficitAlerts(
  transactions: Transaction[],
  customers: Customer[],
  now = new Date(),
  lookbackDays = DEFAULT_CONTAINER_DEFICIT_LOOKBACK_DAYS,
  minDeficitQty = DEFAULT_CONTAINER_DEFICIT_MIN_QTY,
): ContainerDeficitSnapshot {
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - lookbackDays);

  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const buckets = new Map<
    string,
    { totalDeficitQty: number; oldestDays: number; transactionCount: number }
  >();

  for (const tx of transactions) {
    if (!isFulfilledDelivery(tx)) continue;
    const deficitQty = openDeficitQtyOnTransaction(tx);
    if (deficitQty < minDeficitQty) continue;
    if (!tx.customerId) continue;

    const effective =
      parseTxDate(tx.deliveredAt) ??
      parseTxDate(tx.updatedAt) ??
      parseTxDate(tx.scheduledAt) ??
      parseTxDate(tx.createdAt);
    if (!effective || effective < periodStart || effective > now) continue;

    const daysOld = daysBetween(effective, now);
    const cur = buckets.get(tx.customerId) ?? {
      totalDeficitQty: 0,
      oldestDays: 0,
      transactionCount: 0,
    };
    cur.totalDeficitQty += deficitQty;
    cur.oldestDays = Math.max(cur.oldestDays, daysOld);
    cur.transactionCount += 1;
    buckets.set(tx.customerId, cur);
  }

  const rows: ContainerDeficitRow[] = [...buckets.entries()]
    .map(([customerId, bucket]) => ({
      customerId,
      customerName: String(customerNameById.get(customerId) || "Customer").trim(),
      totalDeficitQty: bucket.totalDeficitQty,
      oldestDays: bucket.oldestDays,
      transactionCount: bucket.transactionCount,
    }))
    .filter((row) => row.totalDeficitQty >= minDeficitQty)
    .sort(
      (a, b) =>
        b.totalDeficitQty - a.totalDeficitQty || b.oldestDays - a.oldestDays,
    );

  const totalDeficitQty = rows.reduce((sum, row) => sum + row.totalDeficitQty, 0);

  return { count: rows.length, totalDeficitQty, rows };
}
