import { CustomerService } from "../customers/customer-service";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import {
  coerceToDate,
  manilaDateKey,
} from "../../utils/philippine-datetime";
import {
  isTransactionForManilaDay,
  manilaDayBounds,
} from "../offline/offline-snapshot-service";
import type { RiderMessengerJobRow } from "./rider-messenger-types";

const RIDER_TX_TYPES = new Set(["delivery", "collection"]);
const DONE_STATUSES = new Set(["completed", "cancelled", "failed"]);
const AWAITING_COMPLETION = new Set(["delivered", "collected"]);
const TX_LIMIT = 500;

function jobItemsSummary(tx: Transaction): string {
  if (tx.type === "collection") {
    const n = tx.collectionItems?.length ?? 0;
    return n ? `${n} item${n === 1 ? "" : "s"} to collect` : "Collection run";
  }
  const refills = tx.waterRefills?.reduce((s, r) => s + (r.quantity || 0), 0) ?? 0;
  if (refills > 0) return `${refills} refill${refills === 1 ? "" : "s"}`;
  const items = tx.items?.reduce((s, i) => s + (i.quantity || 0), 0) ?? 0;
  if (items > 0) return `${items} item${items === 1 ? "" : "s"}`;
  return "Delivery";
}

function scheduleDay(tx: Transaction): Date {
  const d = coerceToDate(tx.scheduledAt || tx.createdAt);
  if (!d) return new Date(0);
  const key = manilaDateKey(d);
  return new Date(`${key}T00:00:00+08:00`);
}

function isVisibleForLinkedRider(tx: Transaction, riderId: string): boolean {
  if (!RIDER_TX_TYPES.has(String(tx.type))) return false;
  if (!tx.riderId?.trim()) return true;
  return tx.riderId === riderId;
}

function classifyJob(
  tx: Transaction,
  customerPhone?: string,
): Omit<RiderMessengerJobRow, "index"> | null {
  const s = tx.deliveryStatus;
  if (!s) return null;

  const todayKey = manilaDateKey();
  const { start: todayStart } = manilaDayBounds(todayKey);
  const day = scheduleDay(tx);

  const base = {
    transactionId: tx.id!,
    referenceId: tx.referenceId || tx.id || "—",
    customerName: tx.customerName || "Customer",
    type: tx.type as "delivery" | "collection",
    status: s,
    itemsSummary: jobItemsSummary(tx),
    phone: customerPhone,
    isTodo: false,
    isDoneToday: false,
  };

  if (DONE_STATUSES.has(s)) {
    const completionSource = tx.deliveredAt || tx.updatedAt;
    if (!completionSource) return null;
    const doneDate = coerceToDate(completionSource);
    if (!doneDate || manilaDateKey(doneDate) !== todayKey) return null;
    return { ...base, isTodo: false, isDoneToday: true };
  }

  if (AWAITING_COMPLETION.has(s)) {
    return { ...base, isTodo: true, isDoneToday: false };
  }

  if (s === "in-transit") {
    return { ...base, isTodo: true, isDoneToday: false };
  }

  const isDue = day.getTime() <= todayStart.getTime();
  const isFuture = day.getTime() > todayStart.getTime();

  if (s === "placed" || s === "pending") {
    if (isDue) return { ...base, isTodo: true, isDoneToday: false };
    if (isFuture) return { ...base, isTodo: false, isDoneToday: false };
    return null;
  }

  if (isFuture) {
    return { ...base, isTodo: false, isDoneToday: false };
  }

  return { ...base, isTodo: true, isDoneToday: false };
}

export type RiderMessengerJobsFilter = "all" | "delivery" | "collection";

export async function loadRiderMessengerJobs(params: {
  businessId: string;
  riderId: string;
  filter?: RiderMessengerJobsFilter;
}): Promise<RiderMessengerJobRow[]> {
  const filter = params.filter ?? "all";
  const dayKey = manilaDateKey();
  const transactions = await TransactionService.getTransactionsByBusiness(
    params.businessId,
    { limit: TX_LIMIT, orderBy: "scheduledAt" },
  );

  const visible = transactions.filter(
    (tx) =>
      isVisibleForLinkedRider(tx, params.riderId) &&
      isTransactionForManilaDay(tx, dayKey),
  );

  const customers = await CustomerService.getCustomersByBusiness(params.businessId);
  const phoneByCustomerId = new Map<string, string>();
  for (const c of customers) {
    if (c.id && c.phone?.trim()) phoneByCustomerId.set(c.id, c.phone.trim());
  }

  const jobs: Omit<RiderMessengerJobRow, "index">[] = [];
  for (const tx of visible) {
    if (filter === "delivery" && tx.type !== "delivery") continue;
    if (filter === "collection" && tx.type !== "collection") continue;
    const phone = tx.customerId ? phoneByCustomerId.get(tx.customerId) : undefined;
    const job = classifyJob(tx, phone);
    if (!job) continue;
    jobs.push(job);
  }

  jobs.sort((a, b) => {
    if (a.isTodo !== b.isTodo) return a.isTodo ? -1 : 1;
    if (a.isDoneToday !== b.isDoneToday) return a.isDoneToday ? 1 : -1;
    const rank = (status: string) => {
      if (status === "in-transit") return 0;
      if (status === "delivered" || status === "collected") return 1;
      if (status === "pending") return 2;
      if (status === "placed") return 3;
      return 4;
    };
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return a.referenceId.localeCompare(b.referenceId);
  });

  return jobs.map((job, idx) => ({ ...job, index: idx + 1 }));
}

export function formatJobsListMessage(jobs: RiderMessengerJobRow[]): string {
  if (!jobs.length) {
    return "Walang job ngayong araw. I-send ang JOBS anytime para i-refresh.";
  }

  const todo = jobs.filter((j) => j.isTodo);
  const done = jobs.filter((j) => j.isDoneToday);

  const lines: string[] = [];
  if (todo.length) {
    lines.push("📋 TODO:");
    for (const j of todo) {
      const typeLabel = j.type === "collection" ? "COL" : "DEL";
      lines.push(
        `${j.index}. ${j.referenceId} · ${j.customerName} (${typeLabel}) — ${j.status}`,
      );
    }
  }
  if (done.length) {
    if (lines.length) lines.push("");
    lines.push("✅ DONE TODAY:");
    for (const j of done) {
      lines.push(`${j.index}. ${j.referenceId} · ${j.customerName}`);
    }
  }
  if (!todo.length && !done.length) {
    return "Walang active job ngayong araw. I-send ang JOBS anytime para i-refresh.";
  }

  lines.push("");
  lines.push("Commands: START # · DONE # · DETAILS # · REPORT #");
  return lines.join("\n").slice(0, 1900);
}

export function resolveJobTarget(
  jobs: RiderMessengerJobRow[],
  token: string,
): RiderMessengerJobRow | null {
  const raw = token.trim();
  if (!raw) return null;
  const asIndex = Number.parseInt(raw, 10);
  if (Number.isFinite(asIndex) && asIndex > 0) {
    return jobs.find((j) => j.index === asIndex) ?? null;
  }
  const upper = raw.toUpperCase();
  return (
    jobs.find((j) => j.referenceId.toUpperCase() === upper) ??
    jobs.find((j) => j.transactionId === raw) ??
    null
  );
}
