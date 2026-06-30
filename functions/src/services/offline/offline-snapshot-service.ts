import { db } from "../../config/firebase-admin";
import {
  CustomerService,
  type Customer,
} from "../customers/customer-service";
import { isCustomerActiveForLimit } from "../customers/customer-active-limit-service";
import {
  InventoryService,
  type InventoryItem,
} from "../inventory/inventory-service";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import {
  coerceToDate,
  manilaDateKey,
  PHILIPPINE_TIMEZONE,
} from "../../utils/philippine-datetime";

const CUSTOMER_LIMIT = 400;
const INVENTORY_LIMIT = 120;
const TX_SCHEDULED_LIMIT = 200;
const TX_RECENT_LIMIT = 120;

export type OfflineSnapshotCustomer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  status: Customer["status"];
  type: Customer["type"];
  pricing?: Record<string, number>;
  possession?: Customer["possession"];
  isDeliveryEnabled: boolean;
  isCollectionEnabled: boolean;
  latitude?: number;
  longitude?: number;
  hasBalance?: boolean;
};

export type OfflineSnapshotInventoryItem = {
  id: string;
  name: string;
  categoryId: string;
  stockCurrent: number;
  stockMin: number;
  stockUnit?: string;
  cost: number;
};

export type OfflineSnapshotTransaction = {
  id: string;
  referenceId: string;
  type: Transaction["type"];
  customerId?: string;
  customerName: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: Transaction["paymentStatus"];
  paymentMethod: Transaction["paymentMethod"];
  deliveryStatus: Transaction["deliveryStatus"];
  riderId?: string;
  riderName?: string;
  scheduledAt?: string;
  createdAt?: string;
  walkInQueueNumber?: number;
};

export type OfflineSnapshot = {
  businessId: string;
  businessName: string;
  generatedAt: string;
  manilaDayKey: string;
  waterTypes?: unknown[];
  inventoryCategories?: unknown[];
  expenseCategories?: unknown[];
  customers: OfflineSnapshotCustomer[];
  inventory: OfflineSnapshotInventoryItem[];
  todaysTransactions: OfflineSnapshotTransaction[];
  counts: {
    customers: number;
    inventory: number;
    todaysTransactions: number;
  };
};

function isoOrUndefined(value: unknown): string | undefined {
  const d = coerceToDate(value);
  return d ? d.toISOString() : undefined;
}

/** Calendar bounds for a Manila business day. */
export function manilaDayBounds(dayKey = manilaDateKey()): {
  start: Date;
  end: Date;
  dayKey: string;
} {
  return {
    dayKey,
    start: new Date(`${dayKey}T00:00:00+08:00`),
    end: new Date(`${dayKey}T23:59:59.999+08:00`),
  };
}

/** True when scheduled or created instant falls on the given Manila day. */
export function isTransactionForManilaDay(
  tx: Pick<Transaction, "scheduledAt" | "createdAt">,
  dayKey: string,
): boolean {
  const scheduled = coerceToDate(tx.scheduledAt);
  if (scheduled && manilaDateKey(scheduled) === dayKey) return true;
  const created = coerceToDate(tx.createdAt);
  if (created && manilaDateKey(created) === dayKey) return true;
  return false;
}

export function toLeanCustomer(customer: Customer): OfflineSnapshotCustomer | null {
  if (!customer.id) return null;
  if (!isCustomerActiveForLimit(customer.status)) return null;
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    status: customer.status,
    type: customer.type,
    pricing: customer.pricing,
    possession: customer.possession,
    isDeliveryEnabled: customer.isDeliveryEnabled,
    isCollectionEnabled: customer.isCollectionEnabled,
    latitude: customer.latitude,
    longitude: customer.longitude,
    hasBalance: customer.hasBalance,
  };
}

export function toLeanInventoryItem(item: InventoryItem): OfflineSnapshotInventoryItem | null {
  if (!item.id) return null;
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    stockCurrent: item.stock?.current ?? 0,
    stockMin: item.stock?.min ?? 0,
    stockUnit: item.stock?.unit,
    cost: item.cost ?? 0,
  };
}

export function toLeanTransaction(tx: Transaction): OfflineSnapshotTransaction | null {
  if (!tx.id) return null;
  return {
    id: tx.id,
    referenceId: tx.referenceId,
    type: tx.type,
    customerId: tx.customerId,
    customerName: tx.customerName,
    totalAmount: tx.totalAmount,
    amountPaid: tx.amountPaid,
    balanceDue: tx.balanceDue,
    paymentStatus: tx.paymentStatus,
    paymentMethod: tx.paymentMethod,
    deliveryStatus: tx.deliveryStatus,
    riderId: tx.riderId,
    riderName: tx.riderName,
    scheduledAt: isoOrUndefined(tx.scheduledAt),
    createdAt: isoOrUndefined(tx.createdAt),
    walkInQueueNumber: tx.walkInQueueNumber,
  };
}

export function mergeTodaysTransactions(
  scheduled: Transaction[],
  recent: Transaction[],
  dayKey: string,
): OfflineSnapshotTransaction[] {
  const seen = new Set<string>();
  const rows: OfflineSnapshotTransaction[] = [];

  for (const tx of [...scheduled, ...recent]) {
    if (!tx.id || seen.has(tx.id)) continue;
    if (!isTransactionForManilaDay(tx, dayKey)) continue;
    const lean = toLeanTransaction(tx);
    if (!lean) continue;
    seen.add(tx.id);
    rows.push(lean);
  }

  rows.sort((a, b) => {
    const aTs = Date.parse(a.scheduledAt ?? a.createdAt ?? "") || 0;
    const bTs = Date.parse(b.scheduledAt ?? b.createdAt ?? "") || 0;
    return bTs - aTs;
  });

  return rows;
}

/**
 * Builds a lean workspace snapshot for offline read cache (OFF-03 / OFF-10).
 */
export async function buildOfflineSnapshot(
  businessId: string,
  now = new Date(),
): Promise<OfflineSnapshot> {
  const { dayKey, start, end } = manilaDayBounds(manilaDateKey(now));

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  if (!bizSnap.exists) {
    throw new Error("Business not found");
  }
  const biz = bizSnap.data() ?? {};

  const [customers, inventory, scheduledTx, recentTx] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId).then((rows) =>
      rows.slice(0, CUSTOMER_LIMIT),
    ),
    InventoryService.listItems(businessId).then((rows) =>
      rows.slice(0, INVENTORY_LIMIT),
    ),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_SCHEDULED_LIMIT,
      orderBy: "scheduledAt",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_RECENT_LIMIT,
      orderBy: "createdAt",
    }),
  ]);

  const leanCustomers = customers
    .map(toLeanCustomer)
    .filter((row): row is OfflineSnapshotCustomer => row !== null);

  const leanInventory = inventory
    .map(toLeanInventoryItem)
    .filter((row): row is OfflineSnapshotInventoryItem => row !== null);

  const todaysTransactions = mergeTodaysTransactions(
    scheduledTx,
    recentTx,
    dayKey,
  );

  return {
    businessId,
    businessName: String(biz.name || "Station").trim(),
    generatedAt: now.toISOString(),
    manilaDayKey: dayKey,
    waterTypes: Array.isArray(biz.waterTypes) ? biz.waterTypes : undefined,
    inventoryCategories: Array.isArray(biz.inventoryCategories) ?
      biz.inventoryCategories :
      undefined,
    expenseCategories: Array.isArray(biz.expenseCategories) ?
      biz.expenseCategories :
      undefined,
    customers: leanCustomers,
    inventory: leanInventory,
    todaysTransactions,
    counts: {
      customers: leanCustomers.length,
      inventory: leanInventory.length,
      todaysTransactions: todaysTransactions.length,
    },
  };
}

export const OFFLINE_SNAPSHOT_TIMEZONE = PHILIPPINE_TIMEZONE;
