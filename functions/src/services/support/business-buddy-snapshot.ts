import { db } from "../../config/firebase-admin";
import {
  detectGettingStartedFromCollections,
} from "../business/getting-started-sync-service";
import {
  DEFAULT_GETTING_STARTED,
  type GettingStartedKey,
} from "../business/business-onboarding-defaults";
import { CustomerService, type Customer } from "../customers/customer-service";
import { InventoryService, type InventoryItem } from "../inventory/inventory-service";
import { RiderService, type Rider } from "../riders/rider-service";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import { buildPaymentReminderQueue } from "../../utils/payment-reminder-queue";
import {
  buildWorkspaceRevenueMetrics,
  type WorkspaceRevenueMetrics,
} from "../../utils/ledger-collected-revenue";
import {
  coerceToDate,
  manilaDateKey,
  PHILIPPINE_TIMEZONE,
} from "../../utils/philippine-datetime";

const TX_SCHEDULED_LIMIT = 320;
const TX_RECENT_LIMIT = 180;
const CUSTOMER_LIMIT = 400;
const INVENTORY_LIMIT = 120;
const PENDING_PORTAL_LIMIT = 30;
const TOP_UNPAID_LIMIT = 12;

const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered",
  "collected",
  "cancelled",
  "failed",
]);

export type BuddyScheduleStop = {
  referenceId: string;
  customerName: string;
  type: Transaction["type"];
  deliveryStatus: string;
  scheduledDay: string;
  gallons: number;
  riderName?: string;
  balanceDue: number;
};

export type BuddyPendingPortalOrder = {
  id: string;
  customerName: string;
  type: string;
  status: string;
  scheduledDay: string | null;
};

export type BuddyLowStockItem = {
  name: string;
  current: number;
  min: number;
};

export type BuddyUnpaidCustomer = {
  name: string;
  amountPhp: number;
  oldestDebtDays: number;
};

export type BuddyRiderSummary = {
  name: string;
  status: string;
  deliveriesToday: number;
};

export type BusinessBuddySnapshot = {
  businessName: string;
  generatedAt: string;
  counts: {
    customers: number;
    transactionsLoaded: number;
    inventoryItems: number;
    activeRiders: number;
    pendingPortalOrders: number;
  };
  revenue: WorkspaceRevenueMetrics;
  ops: {
    dormantCount: number;
    unpaidTotalPhp: number;
    openDeliveryCount: number;
    callTodayCount: number;
  };
  schedule: {
    tomorrow: BuddyScheduleStop[];
    next7Days: BuddyScheduleStop[];
    openInFlight: BuddyScheduleStop[];
  };
  pendingPortalOrders: BuddyPendingPortalOrder[];
  lowStockItems: BuddyLowStockItem[];
  topUnpaidCustomers: BuddyUnpaidCustomer[];
  riders: BuddyRiderSummary[];
  cadenceLateSuki: Array<{ name: string; daysSilent: number }>;
};

function offsetManilaDateKey(dayKey: string, offsetDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return utc.toLocaleDateString("en-CA", { timeZone: PHILIPPINE_TIMEZONE });
}

function mergeTransactions(
  primary: Transaction[],
  secondary: Transaction[],
): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const tx of [...primary, ...secondary]) {
    const id = tx.id || tx.referenceId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, tx);
  }
  return [...byId.values()];
}

function scheduledDayKey(tx: Transaction): string | null {
  const d = coerceToDate(tx.scheduledAt ?? tx.createdAt);
  return d ? manilaDateKey(d) : null;
}

function refillGallons(tx: Transaction): number {
  return (tx.waterRefills || [])
    .filter((line) => line.waterTypeId !== "operating_expense")
    .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
}

function isLogisticsStop(tx: Transaction): boolean {
  return tx.type === "delivery" || tx.type === "collection";
}

function isOpenLogisticsStop(tx: Transaction): boolean {
  if (!isLogisticsStop(tx)) return false;
  const status = tx.deliveryStatus || "pending";
  return !TERMINAL_STATUSES.has(status);
}

function toScheduleStop(tx: Transaction): BuddyScheduleStop {
  return {
    referenceId: tx.referenceId || tx.id || "",
    customerName: tx.customerName || "Unknown",
    type: tx.type,
    deliveryStatus: tx.deliveryStatus || "pending",
    scheduledDay: scheduledDayKey(tx) || "",
    gallons: refillGallons(tx),
    riderName: tx.riderName,
    balanceDue: Math.round((Number(tx.balanceDue) || 0) * 100) / 100,
  };
}

function buildScheduleSlices(
  transactions: Transaction[],
  now = new Date(),
): BusinessBuddySnapshot["schedule"] {
  const todayKey = manilaDateKey(now);
  const tomorrowKey = offsetManilaDateKey(todayKey, 1);
  const next7Keys = new Set(
    Array.from({ length: 7 }, (_, i) => offsetManilaDateKey(todayKey, i)),
  );

  const tomorrow: BuddyScheduleStop[] = [];
  const next7Days: BuddyScheduleStop[] = [];
  const openInFlight: BuddyScheduleStop[] = [];

  for (const tx of transactions) {
    if (!isLogisticsStop(tx)) continue;
    const dayKey = scheduledDayKey(tx);
    const stop = toScheduleStop(tx);

    if (isOpenLogisticsStop(tx)) {
      openInFlight.push(stop);
    }

    if (!dayKey) continue;
    if (dayKey === tomorrowKey && isOpenLogisticsStop(tx)) {
      tomorrow.push(stop);
    }
    if (next7Keys.has(dayKey) && isOpenLogisticsStop(tx)) {
      next7Days.push(stop);
    }
  }

  const sortByName = (a: BuddyScheduleStop, b: BuddyScheduleStop) =>
    a.customerName.localeCompare(b.customerName);

  return {
    tomorrow: tomorrow.sort(sortByName).slice(0, 40),
    next7Days: next7Days.sort(sortByName).slice(0, 60),
    openInFlight: openInFlight.sort(sortByName).slice(0, 40),
  };
}

function buildLowStock(items: InventoryItem[]): BuddyLowStockItem[] {
  return items
    .filter((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      return cur <= min;
    })
    .slice(0, 25)
    .map((inv) => ({
      name: inv.name,
      current: inv.stock?.current ?? 0,
      min: inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0,
    }));
}

async function loadPendingPortalOrders(
  businessId: string,
): Promise<BuddyPendingPortalOrder[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions")
    .where("status", "==", "pending_review")
    .limit(PENDING_PORTAL_LIMIT)
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data();
    const payload = (d.payload || {}) as Record<string, unknown>;
    const profile = (payload.profile || {}) as Record<string, unknown>;
    const scheduledRaw = payload.scheduledAt ?? d.createdAt;
    const scheduledDay = coerceToDate(scheduledRaw) ?
      manilaDateKey(coerceToDate(scheduledRaw)!) :
      null;
    return {
      id: doc.id,
      customerName: String(profile.name || d.customerName || "Portal customer"),
      type: String(payload.type || d.type || "order"),
      status: String(d.status || "pending_review"),
      scheduledDay,
    };
  });
}

export async function loadBusinessBuddyFirestoreData(
  businessId: string,
): Promise<{
  businessName: string;
  gettingStarted: Record<GettingStartedKey, boolean>;
  activeRiderCount: number;
  transactions: Transaction[];
  customers: Customer[];
  inventory: InventoryItem[];
  riders: Rider[];
  pendingPortalOrders: BuddyPendingPortalOrder[];
}> {
  const bizRef = db.collection("businesses").doc(businessId);
  const [
    bizSnap,
    detected,
    membersSnap,
    byScheduled,
    byRecent,
    customers,
    inventory,
    riders,
    pendingPortalOrders,
  ] = await Promise.all([
    bizRef.get(),
    detectGettingStartedFromCollections(businessId),
    bizRef.collection("members").limit(50).get(),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_SCHEDULED_LIMIT,
      orderBy: "scheduledAt",
    }),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_RECENT_LIMIT,
      orderBy: "createdAt",
    }),
    CustomerService.getCustomersByBusiness(businessId).then((rows) =>
      rows.slice(0, CUSTOMER_LIMIT),
    ),
    InventoryService.listItems(businessId).then((rows) =>
      rows.slice(0, INVENTORY_LIMIT),
    ),
    RiderService.getRidersByBusiness(businessId),
    loadPendingPortalOrders(businessId),
  ]);

  let activeRiderCount = 0;
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    if (data.isActive === false) continue;
    if (String(data.role || "").toLowerCase() === "rider") activeRiderCount++;
  }

  const gettingStarted: Record<GettingStartedKey, boolean> = {
    ...DEFAULT_GETTING_STARTED,
  };
  for (const key of Object.keys(DEFAULT_GETTING_STARTED) as GettingStartedKey[]) {
    if (detected[key] === true) gettingStarted[key] = true;
  }

  return {
    businessName: String(bizSnap.data()?.name || "your station").trim(),
    gettingStarted,
    activeRiderCount,
    transactions: mergeTransactions(byScheduled, byRecent),
    customers,
    inventory,
    riders,
    pendingPortalOrders,
  };
}

export function buildBusinessBuddySnapshot(
  data: Awaited<ReturnType<typeof loadBusinessBuddyFirestoreData>>,
  now = new Date(),
): BusinessBuddySnapshot {
  const { transactions, customers, inventory, riders, pendingPortalOrders } =
    data;

  const revenue = buildWorkspaceRevenueMetrics(transactions, now);
  const schedule = buildScheduleSlices(transactions, now);

  let openDeliveries = 0;
  for (const tx of transactions) {
    if (tx.type === "delivery" && isOpenLogisticsStop(tx)) openDeliveries++;
  }

  const dormantSignals = buildDormantSignalsSnapshot(customers, transactions, now);
  const debt = computeDebtAgingBreakdown(transactions, customers);
  const unpaidTotalPhp = Math.round(
    debt.rows.reduce((sum, row) => sum + row.amount, 0) * 100,
  ) / 100;
  const callTodayCount = buildPaymentReminderQueue(
    debt.rows,
    customers,
    {
      paymentReminderEnabled: true,
      paymentReminder30Enabled: true,
      paymentReminder60Enabled: true,
      paymentReminder90Enabled: true,
    },
    now,
  ).length;

  const topUnpaidCustomers = debt.rows
    .slice(0, TOP_UNPAID_LIMIT)
    .map((row) => ({
      name: row.name,
      amountPhp: Math.round(row.amount * 100) / 100,
      oldestDebtDays: row.oldestDebtDays,
    }));

  const cadenceLateSuki = (Array.isArray(dormantSignals.sample) ?
    dormantSignals.sample :
    [])
    .filter((row) => (row as { cadenceLate?: boolean }).cadenceLate === true)
    .slice(0, 10)
    .map((row) => {
      const r = row as { name?: string; daysSilent?: number };
      return {
        name: String(r.name || ""),
        daysSilent: Number(r.daysSilent) || 0,
      };
    })
    .filter((row) => row.name);

  return {
    businessName: data.businessName,
    generatedAt: now.toISOString(),
    counts: {
      customers: customers.length,
      transactionsLoaded: transactions.length,
      inventoryItems: inventory.length,
      activeRiders: riders.filter((r) => r.status !== "inactive").length,
      pendingPortalOrders: pendingPortalOrders.length,
    },
    revenue,
    ops: {
      dormantCount: Number(dormantSignals.dormantCount ?? 0),
      unpaidTotalPhp,
      openDeliveryCount: openDeliveries,
      callTodayCount,
    },
    schedule,
    pendingPortalOrders,
    lowStockItems: buildLowStock(inventory),
    topUnpaidCustomers,
    riders: riders
      .filter((r) => r.status !== "inactive")
      .slice(0, 20)
      .map((r) => ({
        name: r.name,
        status: r.status,
        deliveriesToday: r.currentStats?.deliveriesToday ?? 0,
      })),
    cadenceLateSuki,
  };
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value);
}

/** Compact authoritative block for River AI Buddy prompts. */
export function formatBusinessBuddyContextBlock(
  buddy: BusinessBuddySnapshot,
  gettingStarted: Record<GettingStartedKey, boolean>,
  activeRiderCount: number,
): string {
  const { revenue, ops } = buddy;
  const trendLabel =
    revenue.trendVsPriorWeekPct == null ?
      "not enough prior-week data" :
      `${revenue.trendVsPriorWeekPct > 0 ? "+" : ""}${revenue.trendVsPriorWeekPct}% vs prior 7 days`;

  return [
    "## Live Firestore business snapshot (authoritative — NEVER invent beyond this JSON)",
    "Loaded from `businesses/{id}`: transactions, customers, inventory_items, riders, raw_submissions, members.",
    `- Business: ${buddy.businessName}`,
    `- Snapshot at: ${buddy.generatedAt}`,
    `- Records loaded: ${jsonLine(buddy.counts)}`,
    `- Setup: customers=${gettingStarted.addCustomer ? "yes" : "NO"}, delivery=${gettingStarted.addDelivery ? "yes" : "no"}, inventory=${gettingStarted.addInventory ? "yes" : "no"}, riders(active)=${activeRiderCount}`,
    "",
    "### Collected revenue (payment date)",
    jsonLine({
      todayPhp: revenue.todayPhp,
      yesterdayPhp: revenue.yesterdayPhp,
      last7DaysPhp: revenue.last7DaysPhp,
      prior7DaysPhp: revenue.prior7DaysPhp,
      todayCashPhp: revenue.todayBreakdown.cashPhp,
      todayOnlinePhp: revenue.todayBreakdown.onlinePhp,
      expensesTodayPhp: revenue.expensesTodayPhp,
      netTodayPhp: revenue.netTodayPhp,
      forecastNext7DaysPhp: revenue.forecastNext7DaysPhp,
      trendVsPriorWeekPct: trendLabel,
    }),
    "",
    "### Operations health",
    jsonLine(ops),
    "",
    "### Tomorrow deliveries & collections (open stops, scheduled tomorrow Manila)",
    jsonLine(buddy.schedule.tomorrow),
    "",
    "### Next 7 days open schedule",
    jsonLine(buddy.schedule.next7Days),
    "",
    "### Open in-flight deliveries/collections (any date)",
    jsonLine(buddy.schedule.openInFlight),
    "",
    "### Pending portal / QR orders (raw_submissions pending_review)",
    jsonLine(buddy.pendingPortalOrders),
    "",
    "### Top unpaid customers",
    jsonLine(buddy.topUnpaidCustomers),
    "",
    "### Low stock inventory_items",
    jsonLine(buddy.lowStockItems),
    "",
    "### Active riders",
    jsonLine(buddy.riders),
    "",
    "### Suki past usual cadence (retention — consider proactive refill)",
    jsonLine(buddy.cadenceLateSuki),
    "",
    "### Buddy rules (required)",
    "- Personal tone: **ikaw/ka** — e.g. \"Kumita **ka** ng ₱X kahapon\", \"May **4** delivery **ka** bukas\".",
    "- **Answer from JSON first** — exact names, amounts, counts. App navigation goes in **steps[]** only.",
    "- **Tomorrow / sino i-deliver**: use `Tomorrow deliveries` list; if empty, say so and mention `cadenceLateSuki` or `Next 7 days`.",
    "- **Sales / kinita**: use Collected revenue fields for the asked period.",
    "- **Utang**: use topUnpaidCustomers + ops.unpaidTotalPhp.",
    "- **Portal queue**: pending portal orders JSON.",
    "- Never invent customer names, amounts, or delivery refs not in this snapshot.",
  ].join("\n");
}
