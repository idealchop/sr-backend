/**
 * Compact, JSON-safe projection of ledger rows and customers for the
 * incremental analytics materializer.
 *
 * Only the fields the dashboard KPI math reads are kept, with their raw
 * Firestore types preserved (Timestamps become `{ $ts: [seconds, nanos] }`).
 * `decodeProjectedRecord(projectRecord(id, data))` therefore feeds the same
 * values into `computeAnalyticsMaterialization` as a fresh Firestore read, and
 * `orderProjectedDesc` reproduces Firestore's `orderBy(field, "desc")` order,
 * so incremental output equals a full recount.
 */

import { Timestamp } from "firebase-admin/firestore";

export const ANALYTICS_STATE_VERSION = 1;

/** Raw-value encoding stored inside state shard payloads. */
export type EncodedValue =
  | null
  | boolean
  | number
  | string
  | EncodedValue[]
  | { [key: string]: EncodedValue };

/** One projected document (doc id + whitelisted fields). */
export type ProjectedRecord = {
  docId: string;
  data: Record<string, EncodedValue>;
};

type FieldSpec = {
  scalars: readonly string[];
  arrays: Readonly<Record<string, readonly string[]>>;
};

/**
 * Every transaction field read by computeAnalyticsMaterialization and the
 * utils it calls (debt aging, dormant, cohorts, suki health, daily rollups).
 * `id` is kept because `{ id: doc.id, ...doc.data() }` lets a stored `id` win.
 */
export const TX_PROJECTION_FIELDS: FieldSpec = {
  scalars: [
    "id",
    "customerId",
    "type",
    "deliveryStatus",
    "paymentStatus",
    "totalAmount",
    "amountPaid",
    "balanceDue",
    "paymentMethod",
    "scheduledAt",
    "createdAt",
    "updatedAt",
    "deliveredAt",
    "serviceRating",
    "rating",
    "riderRating",
  ],
  arrays: {
    payments: ["amount", "date", "method", "voided"],
    waterRefills: ["quantity"],
    items: ["quantity"],
    collectionItems: ["qtyCollected", "qtyExpected"],
  },
};

/** Every customer field read by the KPI math (plus createdAt for ordering). */
export const CUSTOMER_PROJECTION_FIELDS: FieldSpec = {
  scalars: [
    "id",
    "name",
    "phone",
    "status",
    "healthScore",
    "lastFulfilledAt",
    "lastOrderAt",
    "lastFulfilledType",
    "createdAt",
  ],
  arrays: {},
};

type TimestampLike = { seconds: number; nanoseconds: number; toDate: () => Date };

function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function" &&
    typeof (value as { seconds?: unknown }).seconds === "number" &&
    typeof (value as { nanoseconds?: unknown }).nanoseconds === "number"
  );
}

function encodeMillis(ms: number): EncodedValue {
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms - seconds * 1000) * 1_000_000;
  return { $ts: [seconds, nanos] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Encodes one raw Firestore value. Returns undefined for absent values.
 * @param {unknown} value Raw field value.
 * @return {EncodedValue | undefined} JSON-safe value.
 */
export function encodeValue(value: unknown): EncodedValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : { $num: String(value) };
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? { $num: "InvalidDate" } : encodeMillis(ms);
  }
  if (isTimestampLike(value)) {
    return { $ts: [value.seconds, value.nanoseconds] };
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return encodeMillis(d.getTime());
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeValue(entry) ?? null);
  }
  if (isPlainObject(value)) {
    const out: Record<string, EncodedValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const encoded = encodeValue(entry);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  // Unsupported special types (GeoPoint, refs, bytes) are not read by KPI math.
  return null;
}

function isEncodedTimestamp(value: unknown): value is { $ts: [number, number] } {
  return (
    isPlainObject(value) &&
    Array.isArray((value as { $ts?: unknown }).$ts) &&
    Object.keys(value).length === 1
  );
}

function isEncodedSpecialNumber(value: unknown): value is { $num: string } {
  return (
    isPlainObject(value) &&
    typeof (value as { $num?: unknown }).$num === "string" &&
    Object.keys(value).length === 1
  );
}

/**
 * Decodes an encoded value back into what the KPI math expects
 * (Timestamps become `Timestamp.toDate()`).
 * @param {EncodedValue} value Encoded value.
 * @return {unknown} Decoded value.
 */
export function decodeValue(value: EncodedValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => decodeValue(entry));
  if (isEncodedTimestamp(value)) {
    const [seconds, nanos] = value.$ts;
    // Same rounding as the Timestamp the full recount sees.
    return new Timestamp(seconds, nanos).toDate();
  }
  if (isEncodedSpecialNumber(value)) {
    if (value.$num === "InvalidDate") return new Date(NaN);
    return Number(value.$num);
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = decodeValue(entry);
  return out;
}

function projectArray(raw: unknown, subFields: readonly string[]): EncodedValue | undefined {
  if (!Array.isArray(raw)) return encodeValue(raw);
  return raw.map((entry) => {
    if (!isPlainObject(entry)) return encodeValue(entry) ?? null;
    const out: Record<string, EncodedValue> = {};
    for (const key of subFields) {
      const encoded = encodeValue(entry[key]);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  });
}

/**
 * Projects one Firestore document onto the whitelisted fields.
 * @param {string} docId Document id.
 * @param {Record<string, unknown>} data Raw `doc.data()`.
 * @param {FieldSpec} spec Field whitelist.
 * @return {ProjectedRecord} Compact record.
 */
export function projectRecord(
  docId: string,
  data: Record<string, unknown>,
  spec: FieldSpec,
): ProjectedRecord {
  const out: Record<string, EncodedValue> = {};
  for (const key of spec.scalars) {
    if (!(key in data)) continue;
    const encoded = encodeValue(data[key]);
    if (encoded !== undefined) out[key] = encoded;
  }
  for (const [key, subFields] of Object.entries(spec.arrays)) {
    if (!(key in data)) continue;
    const encoded = projectArray(data[key], subFields);
    if (encoded !== undefined) out[key] = encoded;
  }
  return { docId, data: out };
}

export const projectTransactionRecord = (docId: string, data: Record<string, unknown>) =>
  projectRecord(docId, data, TX_PROJECTION_FIELDS);

export const projectCustomerRecord = (docId: string, data: Record<string, unknown>) =>
  projectRecord(docId, data, CUSTOMER_PROJECTION_FIELDS);

/**
 * Rebuilds the `{ id: doc.id, ...doc.data() }` row shape the services return.
 * @param {ProjectedRecord} record Projected record.
 * @return {Record<string, unknown>} Row for KPI math.
 */
export function decodeProjectedRecord<T = Record<string, unknown>>(record: ProjectedRecord): T {
  const row: Record<string, unknown> = { id: record.docId };
  for (const [key, value] of Object.entries(record.data)) {
    row[key] = decodeValue(value);
  }
  return row as T;
}

// ---- Firestore ordering ---------------------------------------------------

function typeRank(value: EncodedValue): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (isEncodedSpecialNumber(value)) return 2;
  if (isEncodedTimestamp(value)) return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 8;
  return 9;
}

function numericValue(value: EncodedValue): number {
  if (typeof value === "number") return value;
  if (isEncodedSpecialNumber(value)) return Number(value.$num);
  return 0;
}

function compareNumbers(a: number, b: number): number {
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  if (aNaN || bNaN) return aNaN === bNaN ? 0 : aNaN ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Ascending Firestore value comparison (type order, then value).
 * @param {EncodedValue} a Left.
 * @param {EncodedValue} b Right.
 * @return {number} Sign.
 */
export function compareFirestoreValues(a: EncodedValue, b: EncodedValue): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (ra) {
  case 1:
    return a === b ? 0 : a ? 1 : -1;
  case 2:
    return compareNumbers(numericValue(a), numericValue(b));
  case 3: {
    const [sa, na] = (a as { $ts: [number, number] }).$ts;
    const [sb, nb] = (b as { $ts: [number, number] }).$ts;
    return compareNumbers(sa, sb) || compareNumbers(na, nb);
  }
  case 4:
    return compareUtf8(a as string, b as string);
  default:
    return 0;
  }
}

/**
 * Mirrors `collection.orderBy(field, "desc").limit(limit)`: rows missing the
 * field are excluded; ties break on document id descending.
 * @param {Iterable<ProjectedRecord>} records Projected records.
 * @param {string} field Order field.
 * @param {number | null} limit Optional cap.
 * @return {ProjectedRecord[]} Ordered records.
 */
export function orderProjectedDesc(
  records: Iterable<ProjectedRecord>,
  field: string,
  limit: number | null = null,
): ProjectedRecord[] {
  const withField = [...records].filter((record) => field in record.data);
  withField.sort((a, b) => {
    const byValue = compareFirestoreValues(b.data[field], a.data[field]);
    if (byValue !== 0) return byValue;
    return compareUtf8(b.docId, a.docId);
  });
  return limit == null ? withField : withField.slice(0, limit);
}

// ---- Sharding -------------------------------------------------------------

/**
 * Stable FNV-1a shard index for a doc id.
 * @param {string} docId Document id.
 * @param {number} shardCount Shard count.
 * @return {number} 0-based shard.
 */
export function shardIndexForId(docId: string, shardCount: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < docId.length; i++) {
    hash ^= docId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % Math.max(1, shardCount);
}

/** Map of docId → projected data, one per shard. */
export type ProjectionShard = Record<string, Record<string, EncodedValue>>;

/**
 * Splits records into shard maps.
 * @param {Iterable<ProjectedRecord>} records Records.
 * @param {number} shardCount Shard count.
 * @return {ProjectionShard[]} Shards.
 */
export function shardRecords(
  records: Iterable<ProjectedRecord>,
  shardCount: number,
): ProjectionShard[] {
  const shards: ProjectionShard[] = Array.from({ length: shardCount }, () => ({}));
  for (const record of records) {
    shards[shardIndexForId(record.docId, shardCount)][record.docId] = record.data;
  }
  return shards;
}

/**
 * Flattens shard maps back into a docId → record map.
 * @param {ProjectionShard[]} shards Shards.
 * @return {Map<string, ProjectedRecord>} Records by doc id.
 */
export function recordsFromShards(shards: ProjectionShard[]): Map<string, ProjectedRecord> {
  const out = new Map<string, ProjectedRecord>();
  for (const shard of shards) {
    for (const [docId, data] of Object.entries(shard)) out.set(docId, { docId, data });
  }
  return out;
}

/**
 * Upserts/removes records and reports which shards changed.
 * @param {Map<string, ProjectedRecord>} records Mutable record map.
 * @param {ProjectedRecord[]} upserts Changed docs (re-read from Firestore).
 * @param {Iterable<string>} deletedIds Hard-deleted doc ids.
 * @param {number} shardCount Shard count.
 * @return {Set<number>} Dirty shard indexes.
 */
export function applyProjectionChanges(
  records: Map<string, ProjectedRecord>,
  upserts: ProjectedRecord[],
  deletedIds: Iterable<string>,
  shardCount: number,
): Set<number> {
  const dirty = new Set<number>();
  for (const record of upserts) {
    const prev = records.get(record.docId);
    if (prev && JSON.stringify(prev.data) === JSON.stringify(record.data)) continue;
    records.set(record.docId, record);
    dirty.add(shardIndexForId(record.docId, shardCount));
  }
  for (const docId of deletedIds) {
    if (!records.delete(docId)) continue;
    dirty.add(shardIndexForId(docId, shardCount));
  }
  return dirty;
}
