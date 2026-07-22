import { logger } from "firebase-functions";
import type { DocumentData, Query, Timestamp } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";

const STATS_DOC = "platform/marketing_stats";
/** Bump when metric definitions change so stale cache values are replaced. */
const METRIC_VERSION = 4;
/** Recompute at most this often — public landing polls frequently. */
export const MARKETING_STATS_TTL_MS = 5 * 60 * 1000;
/** Ledger `waterRefills.quantity` is gallon-equivalent units. */
const LITERS_PER_GALLON = 3.78541;
const TX_PAGE_SIZE = 500;

const VOLUME_TX_TYPES = new Set(["delivery", "walkin", "direct_sale"]);
const FULFILLED_DELIVERY_STATUSES = new Set([
  "delivered",
  "completed",
  "collected",
]);

export type MarketingPlatformStats = {
  litersDelivered: number;
  transactionsProcessed: number;
  wrsOperators: number;
  customersServed: number;
  updatedAt: string | null;
  /** Soft growth rates so the landing odometer keeps ticking between polls. */
  ratesPerHour: {
    litersDelivered: number;
    transactionsProcessed: number;
    wrsOperators: number;
    customersServed: number;
  };
};

type StoredStats = {
  metricVersion?: number;
  litersDelivered?: number;
  transactionsProcessed?: number;
  wrsOperators?: number;
  customersServed?: number;
  updatedAt?: Timestamp | Date | string | null;
  previous?: {
    litersDelivered?: number;
    transactionsProcessed?: number;
    wrsOperators?: number;
    customersServed?: number;
    updatedAtMs?: number;
  };
  refreshingAtMs?: number;
};

function toMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

function toIso(value: unknown): string | null {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

async function countQuery(query: Query): Promise<number> {
  const snap = await query.count().get();
  return Math.max(0, Number(snap.data().count) || 0);
}

/**
 * WRS Operators = unique SmartRefill owner users (distinct `businesses.ownerId`).
 */
export async function countUniqueOwnerUsers(): Promise<number> {
  const snap = await db.collection("businesses").select("ownerId").get();
  const owners = new Set<string>();
  for (const doc of snap.docs) {
    const ownerId = String(doc.data()?.ownerId || "").trim();
    if (ownerId) owners.add(ownerId);
  }
  return owners.size;
}

/**
 * True for fulfilled delivery / walk-in / direct-sale ledger rows that carry refill volume.
 */
export function isVolumeSalesTransaction(data: DocumentData | undefined): boolean {
  if (!data) return false;
  const type = String(data.type || "").toLowerCase();
  if (!VOLUME_TX_TYPES.has(type)) return false;
  if (type === "walkin" || type === "direct_sale") return true;
  const status = String(data.deliveryStatus || "").toLowerCase();
  return FULFILLED_DELIVERY_STATUSES.has(status);
}

/** Gallon-equivalent units from `waterRefills` on a sales transaction. */
export function gallonsFromVolumeSalesTx(data: DocumentData | undefined): number {
  if (!isVolumeSalesTransaction(data)) return 0;
  const refills = Array.isArray(data?.waterRefills) ? data.waterRefills : [];
  let gallons = 0;
  for (const row of refills) {
    if (String(row?.waterTypeId || "") === "operating_expense") continue;
    gallons += Math.max(0, Number(row?.quantity) || 0);
  }
  return gallons;
}

/**
 * Liters Delivered = sum of refill volume on delivery + walk-in + direct-sale
 * transactions across all WRS (gallon units → liters).
 */
export async function sumTransactionVolumeLiters(): Promise<number> {
  let gallons = 0;
  let query: Query = db
    .collectionGroup("transactions")
    .select("type", "deliveryStatus", "waterRefills")
    .limit(TX_PAGE_SIZE);

  for (;;) {
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      gallons += gallonsFromVolumeSalesTx(doc.data());
    }
    if (snap.size < TX_PAGE_SIZE) break;
    const last = snap.docs[snap.docs.length - 1];
    query = db
      .collectionGroup("transactions")
      .select("type", "deliveryStatus", "waterRefills")
      .startAfter(last)
      .limit(TX_PAGE_SIZE);
  }

  return Math.round(gallons * LITERS_PER_GALLON);
}

/**
 * Metric definitions (landing strip):
 * - wrsOperators → unique owner users
 * - customersServed → all customers across all WRS
 * - transactionsProcessed → all ledger transactions across all WRS
 * - litersDelivered → refill volume on delivery + walkin + direct_sale (→ liters)
 */
async function recomputeCounts(): Promise<{
  litersDelivered: number;
  transactionsProcessed: number;
  wrsOperators: number;
  customersServed: number;
}> {
  const [wrsOperators, customersServed, transactionsProcessed, litersDelivered] =
    await Promise.all([
      countUniqueOwnerUsers(),
      countQuery(db.collectionGroup("customers")),
      countQuery(db.collectionGroup("transactions")),
      sumTransactionVolumeLiters(),
    ]);

  return {
    litersDelivered,
    transactionsProcessed,
    wrsOperators,
    customersServed,
  };
}

function computeRatesPerHour(
  current: {
    litersDelivered: number;
    transactionsProcessed: number;
    wrsOperators: number;
    customersServed: number;
  },
  previous: StoredStats["previous"] | undefined,
  updatedAtMs: number | null,
): MarketingPlatformStats["ratesPerHour"] {
  const prevMs = previous?.updatedAtMs ?? null;
  const elapsedHours =
    prevMs != null && updatedAtMs != null && updatedAtMs > prevMs ?
      (updatedAtMs - prevMs) / (1000 * 60 * 60) :
      0;

  // Only estimate growth when the prior snapshot is old enough to be meaningful.
  const rate = (now: number, was: number | undefined) => {
    if (elapsedHours < 0.25) return 0;
    const delta = Math.max(0, now - (Number(was) || 0));
    return delta / elapsedHours;
  };

  return {
    litersDelivered: rate(current.litersDelivered, previous?.litersDelivered),
    transactionsProcessed: rate(
      current.transactionsProcessed,
      previous?.transactionsProcessed,
    ),
    wrsOperators: rate(current.wrsOperators, previous?.wrsOperators),
    customersServed: rate(current.customersServed, previous?.customersServed),
  };
}

function mapStored(
  raw: StoredStats | undefined,
): MarketingPlatformStats | null {
  if (!raw) return null;
  const updatedAtMs = toMs(raw.updatedAt);
  const current = {
    litersDelivered: Math.max(0, Math.floor(Number(raw.litersDelivered) || 0)),
    transactionsProcessed: Math.max(
      0,
      Math.floor(Number(raw.transactionsProcessed) || 0),
    ),
    wrsOperators: Math.max(0, Math.floor(Number(raw.wrsOperators) || 0)),
    customersServed: Math.max(0, Math.floor(Number(raw.customersServed) || 0)),
  };
  return {
    ...current,
    updatedAt: toIso(raw.updatedAt),
    ratesPerHour: computeRatesPerHour(current, raw.previous, updatedAtMs),
  };
}

async function writeStats(
  next: {
    litersDelivered: number;
    transactionsProcessed: number;
    wrsOperators: number;
    customersServed: number;
  },
  previousRaw: StoredStats | undefined,
): Promise<MarketingPlatformStats> {
  const nowMs = Date.now();
  const prevUpdatedMs = toMs(previousRaw?.updatedAt) ?? nowMs;
  const previous = {
    litersDelivered: Math.max(
      0,
      Math.floor(Number(previousRaw?.litersDelivered) || 0),
    ),
    transactionsProcessed: Math.max(
      0,
      Math.floor(Number(previousRaw?.transactionsProcessed) || 0),
    ),
    wrsOperators: Math.max(0, Math.floor(Number(previousRaw?.wrsOperators) || 0)),
    customersServed: Math.max(
      0,
      Math.floor(Number(previousRaw?.customersServed) || 0),
    ),
    updatedAtMs: prevUpdatedMs,
  };

  await db.doc(STATS_DOC).set(
    {
      ...next,
      metricVersion: METRIC_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
      previous,
      refreshingAtMs: FieldValue.delete(),
      definitions: {
        wrsOperators: "unique_owner_users",
        customersServed: "all_customers_all_wrs",
        transactionsProcessed: "all_transactions_all_wrs",
        litersDelivered: "delivery_walkin_direct_sale_refill_liters",
      },
    },
    { merge: true },
  );

  return {
    ...next,
    updatedAt: new Date(nowMs).toISOString(),
    ratesPerHour: computeRatesPerHour(next, previous, nowMs),
  };
}

/**
 * Public marketing KPIs for the landing stats strip.
 * Serves a cached `platform/marketing_stats` doc; refreshes when stale.
 */
export async function getMarketingPlatformStats(): Promise<MarketingPlatformStats> {
  const ref = db.doc(STATS_DOC);
  const snap = await ref.get();
  const raw = (snap.exists ? snap.data() : undefined) as StoredStats | undefined;
  const versionOk = Number(raw?.metricVersion) === METRIC_VERSION;
  const cached = versionOk ? mapStored(raw) : null;
  const updatedAtMs = toMs(raw?.updatedAt);
  const ageMs = updatedAtMs == null ? Number.POSITIVE_INFINITY : Date.now() - updatedAtMs;
  const fresh = versionOk && ageMs < MARKETING_STATS_TTL_MS;

  if (cached && fresh) {
    return cached;
  }

  const refreshingAtMs = Number(raw?.refreshingAtMs) || 0;
  const refreshInFlight =
    refreshingAtMs > 0 && Date.now() - refreshingAtMs < 120_000;

  if (cached && refreshInFlight) {
    return cached;
  }

  try {
    await ref.set(
      { refreshingAtMs: Date.now() },
      { merge: true },
    );
    const next = await recomputeCounts();
    // Always persist the freshly computed totals (no monotonic carry from
    // soft-tick inflated client values / prior metric versions).
    return await writeStats(next, versionOk ? raw : undefined);
  } catch (error) {
    logger.error("marketing platform stats refresh failed", error);
    if (cached) return cached;
    throw error;
  }
}
