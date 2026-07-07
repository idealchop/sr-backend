import type { Customer } from "../customers/customer-service";
import type {
  CollectionItem,
  Transaction,
  TransactionInventoryItem,
  TransactionRefill,
} from "./transaction-service";
import {
  buildDormantCustomerRows,
  DEFAULT_DORMANT_THRESHOLD_DAYS,
} from "../../utils/dormant-customers";

/** Match dashboard dormant default — no fulfilled order in this many days. */
export const NEARBY_QUIET_THRESHOLD_DAYS = DEFAULT_DORMANT_THRESHOLD_DAYS;

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null) {
    if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
      return (raw as { toDate: () => Date }).toDate();
    }
  }
  return null;
}

function isFulfilledOperational(tx: Transaction): boolean {
  if (tx.type === "expense" || tx.type === "walkin") return false;
  if (tx.type === "collection") {
    const ds = tx.deliveryStatus;
    if (!ds) return true;
    return ["delivered", "completed", "collected"].includes(ds);
  }
  if (tx.type === "delivery") {
    const ds = tx.deliveryStatus || "";
    return ["delivered", "completed", "collected"].includes(ds);
  }
  if (tx.type === "direct_sale") return true;
  return false;
}

function fulfilledOperationalType(
  tx: Transaction,
): "delivery" | "collection" | null {
  if (!isFulfilledOperational(tx)) return null;
  if (tx.type === "collection") return "collection";
  if (tx.type === "delivery") return "delivery";
  return null;
}

function fulfilledOperationalDate(tx: Transaction): Date | null {
  if (!fulfilledOperationalType(tx)) return null;
  return (
    parseDate((tx as { deliveredAt?: unknown }).deliveredAt) ||
    parseDate(tx.updatedAt) ||
    parseDate(tx.scheduledAt) ||
    parseDate(tx.createdAt)
  );
}

export function getLastFulfilledOperationalTransaction(
  customerId: string,
  transactions: Transaction[],
): Transaction | null {
  let best: Transaction | null = null;
  let bestTime = -1;
  for (const tx of transactions) {
    if (tx.customerId !== customerId) continue;
    const type = fulfilledOperationalType(tx);
    if (!type) continue;
    const at = fulfilledOperationalDate(tx);
    if (!at) continue;
    const ms = at.getTime();
    if (ms >= bestTime) {
      bestTime = ms;
      best = tx;
    }
  }
  return best;
}

export type NearbyQuietCustomer = {
  customerId: string;
  customerName: string;
  daysSinceLastOrder: number;
  lastOrderType: "delivery" | "collection";
  lastFulfilledAt: Date;
};

export function buildNearbyQuietCustomers(params: {
  customers: Customer[];
  transactions: Transaction[];
  excludeCustomerIds?: Set<string>;
  thresholdDays?: number;
  now?: Date;
}): NearbyQuietCustomer[] {
  const excluded = params.excludeCustomerIds ?? new Set<string>();
  const dormantRows = buildDormantCustomerRows(
    params.customers,
    params.transactions,
    {
      thresholdDays: params.thresholdDays ?? NEARBY_QUIET_THRESHOLD_DAYS,
      now: params.now,
    },
  );

  return dormantRows
    .filter((row) => !excluded.has(row.customerId))
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.name,
      daysSinceLastOrder: row.daysSinceLastOrder,
      lastOrderType:
        row.lastOrderType === "collection" ? "collection" : "delivery",
      lastFulfilledAt: row.lastFulfilledAt,
    }));
}

export function buildRepeatNearbyTransactionSeed(
  lastTx: Transaction | null,
  customer: Customer,
  daysSinceLastOrder: number,
  orderSpec?: {
    type?: "delivery" | "collection";
    refillQty?: number;
    deliveryLines?: TransactionRefill[];
    items?: TransactionInventoryItem[];
    collectionItems?: CollectionItem[];
    repeatLast?: boolean;
  },
): Partial<Transaction> {
  const forcedType = orderSpec?.type;
  const seed = buildRepeatNearbyTransactionSeedBase(
    lastTx,
    customer,
    daysSinceLastOrder,
  );

  if (forcedType === "collection") {
    if (orderSpec?.collectionItems?.length) {
      return {
        type: "collection",
        collectionItems: orderSpec.collectionItems,
        notes: `${seed.notes ?? ""} · rider order`.trim(),
        deliveryStatus: "pending",
      };
    }
    if (seed.type === "collection" && (seed.collectionItems?.length ?? 0) > 0) {
      return seed;
    }
    return {
      type: "collection",
      collectionItems: seed.collectionItems ?? [],
      notes: seed.notes,
      deliveryStatus: "pending",
    };
  }

  if (orderSpec?.deliveryLines?.length) {
    return {
      type: "delivery",
      waterRefills: orderSpec.deliveryLines,
      items: orderSpec.items ?? [],
      notes: seed.notes,
      deliveryStatus: "pending",
    };
  }

  if (forcedType === "delivery" || orderSpec?.refillQty != null) {
    const preferred =
      (customer.preferredWaterType && String(customer.preferredWaterType).trim()) ||
      "Water";
    const qty = Math.max(1, orderSpec?.refillQty ?? 1);
    const waterRefills =
      seed.type === "delivery" && (seed.waterRefills?.length ?? 0) > 0 && !orderSpec?.refillQty ?
        seed.waterRefills :
        [
          {
            name: preferred,
            waterTypeId: preferred,
            quantity: qty,
            unitPrice: 0,
            subtotal: 0,
          } satisfies TransactionRefill,
        ];
    return {
      type: "delivery",
      waterRefills,
      items: orderSpec?.refillQty ? [] : seed.items,
      notes: seed.notes,
      deliveryStatus: "pending",
    };
  }

  return seed;
}

function buildRepeatNearbyTransactionSeedBase(
  lastTx: Transaction | null,
  customer: Customer,
  daysSinceLastOrder: number,
): Partial<Transaction> {
  const notes = `Nearby quiet suki · ${daysSinceLastOrder}d since last order`;

  if (lastTx?.type === "collection") {
    const collectionItems = (lastTx.collectionItems ?? [])
      .filter((item) => (Number(item.qtyExpected) || 0) > 0)
      .map((item) => ({
        ...item,
        qtyCollected: 0,
        qtyOk: 0,
        qtyDamaged: 0,
        qtyMissing: 0,
        deficitQty: 0,
        status: "pending" as const,
      }));
    if (collectionItems.length > 0) {
      return {
        type: "collection",
        collectionItems,
        notes: `${notes} · repeat collection`,
        deliveryStatus: "pending",
      };
    }
  }

  if (lastTx?.type === "delivery") {
    const waterRefills = (lastTx.waterRefills ?? []).filter(
      (line) => (Number(line.quantity) || 0) > 0,
    );
    const items = (lastTx.items ?? []).filter(
      (line) => (Number(line.quantity) || 0) > 0,
    );
    if (waterRefills.length > 0 || items.length > 0) {
      return {
        type: "delivery",
        waterRefills,
        items,
        notes: `${notes} · repeat delivery`,
        deliveryStatus: "pending",
      };
    }
  }

  const preferred =
    (customer.preferredWaterType && String(customer.preferredWaterType).trim()) ||
    "Water";
  return {
    type: lastTx?.type === "collection" ? "collection" : "delivery",
    waterRefills: [
      {
        name: preferred,
        waterTypeId: preferred,
        quantity: 1,
        unitPrice: 0,
        subtotal: 0,
      } satisfies TransactionRefill,
    ],
    notes,
    deliveryStatus: "pending",
  };
}
