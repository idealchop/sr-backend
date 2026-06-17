import { db } from "../../config/firebase-admin";
import type { RawSubmissionType } from "./raw-submission-types";

/** Statuses customers can still track (excludes terminal / cancelled). */
const TRACKABLE_DELIVERY_STATUSES = [
  "pending",
  "placed",
  "order placed",
  "in-transit",
  "processed",
  "delivered",
  "collected",
];

const TRACKABLE_SUBMISSION_STATUSES = ["pending_review"];

const TRACKABLE_SUBMISSION_TYPES: RawSubmissionType[] = [
  "PLACE_ORDER",
  "REQUEST_COLLECTION",
];

export interface PortalTrackSearchFilters {
  name?: string;
  email?: string;
  company?: string;
  phone?: string;
  /** Legacy single-string search (OR match against any contact field). */
  q?: string;
}

export interface PortalTrackSearchRow {
  transactionId: string;
  referenceId: string;
  type: string;
  typeLabel: string;
  refillLabel: string | null;
  assetLabel: string;
  scheduledAt: string | null;
  status: string;
  customerName: string;
  /** `transaction` = ledger order; `submission` = pending raw_submission. */
  source: "transaction" | "submission";
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Last 10 digits — matches 09XX… vs +639XX…
 * @param {string} value Raw phone string.
 * @return {string} Core digit suffix.
 */
function phoneCoreDigits(value: string): string {
  const d = normalizeDigits(value);
  if (d.length <= 10) return d;
  return d.slice(-10);
}

function isTrackableTxStatus(data: FirebaseFirestore.DocumentData): boolean {
  const status = String(
    data.deliveryStatus || data.status || "pending",
  ).toLowerCase();
  return TRACKABLE_DELIVERY_STATUSES.includes(status);
}

function extractContactParts(data: FirebaseFirestore.DocumentData): string[] {
  const parts: string[] = [];
  if (typeof data.name === "string") parts.push(data.name);
  if (typeof data.email === "string") parts.push(data.email);
  if (typeof data.companyName === "string") parts.push(data.companyName);
  if (typeof data.phone === "string") parts.push(data.phone);
  if (typeof data.customerName === "string") parts.push(data.customerName);

  const contact = data.contact as Record<string, unknown> | undefined;
  if (contact) {
    if (typeof contact.phone === "string") parts.push(contact.phone);
    if (typeof contact.email === "string") parts.push(contact.email);
  }

  const payload = data.payload as Record<string, unknown> | undefined;
  if (payload) {
    const profile = payload.profile as Record<string, unknown> | undefined;
    if (profile) {
      if (typeof profile.name === "string") parts.push(profile.name);
      if (typeof profile.email === "string") parts.push(profile.email);
      if (typeof profile.phone === "string") parts.push(profile.phone);
      if (typeof profile.companyName === "string") {
        parts.push(profile.companyName);
      }
    }
  }

  return parts;
}

function partMatchesValue(
  part: string,
  termLower: string,
  termDigits: string,
): boolean {
  const lower = part.toLowerCase();
  if (lower.includes(termLower) || termLower.includes(lower)) {
    return true;
  }
  if (termDigits.length >= 4) {
    const partCore = phoneCoreDigits(part);
    const termCore = phoneCoreDigits(termDigits);
    if (
      partCore.length >= 4 &&
      termCore.length >= 4 &&
      (partCore.includes(termCore) || termCore.includes(partCore))
    ) {
      return true;
    }
    const partDigits = normalizeDigits(part);
    if (
      partDigits.includes(termDigits) ||
      termDigits.includes(partDigits)
    ) {
      return true;
    }
  }
  return false;
}

function activeSearchTerms(
  filters: PortalTrackSearchFilters,
): { term: string; termLower: string; termDigits: string }[] {
  const terms: { term: string; termLower: string; termDigits: string }[] = [];
  const push = (raw?: string) => {
    const term = (raw || "").trim();
    if (term.length < 2) return;
    terms.push({
      term,
      termLower: term.toLowerCase(),
      termDigits: normalizeDigits(term),
    });
  };
  push(filters.name);
  push(filters.email);
  push(filters.company);
  push(filters.phone);
  if (terms.length === 0) {
    push(filters.q);
  }
  return terms;
}

/**
 * True when any provided filter term matches any contact field (OR logic).
 * @param {FirebaseFirestore.DocumentData} data Customer or raw_submission doc.
 * @param {PortalTrackSearchFilters} filters Search fields.
 * @return {boolean} Whether any term matches.
 */
export function contactMatchesFilters(
  data: FirebaseFirestore.DocumentData,
  filters: PortalTrackSearchFilters,
): boolean {
  const terms = activeSearchTerms(filters);
  if (terms.length === 0) return false;

  const parts = extractContactParts(data);
  if (parts.length === 0) return false;

  return terms.some(({ termLower, termDigits }) =>
    parts.some((part) => partMatchesValue(part, termLower, termDigits)),
  );
}

export function humanTypeLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === "delivery") return "Delivery";
  if (t === "collection") return "Collection";
  if (t === "walkin" || t === "direct_sale") return "Sale";
  if (t === "expense") return "Expense";
  return type || "Order";
}

export function buildRefillAndAsset(tx: FirebaseFirestore.DocumentData): {
  refillLabel: string | null;
  assetLabel: string;
} {
  const type = String(tx.type || "").toLowerCase();
  const refillItems = Array.isArray(tx.refillItems) ? tx.refillItems : [];
  const refills = Array.isArray(tx.waterRefills) ?
    tx.waterRefills :
    refillItems.map((r: { type?: string; qty?: number }) => ({
      quantity: r.qty,
    }));
  const collections = Array.isArray(tx.collectionItems) ?
    tx.collectionItems :
    [];
  const items = Array.isArray(tx.items) ? tx.items : [];

  const hasRefill = refills.length > 0;
  const hasCollect = collections.length > 0 || type === "collection";
  const hasDispatch =
    type === "delivery" || items.length > 0 || hasRefill;

  let assetLabel = "—";
  if (hasDispatch && hasCollect) {
    assetLabel = "D&C";
  } else if (hasCollect) {
    assetLabel = "C";
  } else if (hasDispatch) {
    assetLabel = "D";
  }

  let refillLabel: string | null = null;
  if (hasRefill) {
    const qty = refills.reduce(
      (sum: number, r: { quantity?: number }) =>
        sum + (Number(r?.quantity) || 0),
      0,
    );
    refillLabel = qty > 0 ? `Refill ×${qty}` : "Refill";
  }

  return { refillLabel, assetLabel };
}

function serializeSchedule(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function mapTxDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): PortalTrackSearchRow {
  const d = doc.data();
  const { refillLabel, assetLabel } = buildRefillAndAsset(d);
  return {
    transactionId: doc.id,
    referenceId: String(d.referenceId || doc.id),
    type: String(d.type || ""),
    typeLabel: humanTypeLabel(String(d.type || "")),
    refillLabel,
    assetLabel,
    scheduledAt: serializeSchedule(d.scheduledAt),
    status: String(d.deliveryStatus || d.status || "pending"),
    customerName: String(d.customerName || "Customer"),
    source: "transaction",
  };
}

function mapSubmissionDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): PortalTrackSearchRow {
  const d = doc.data();
  const payload = (d.payload || {}) as FirebaseFirestore.DocumentData;
  const profile = (payload.profile || {}) as FirebaseFirestore.DocumentData;
  const txType = String(
    d.transactionType || payload.type || "delivery",
  );
  const pseudoTx: FirebaseFirestore.DocumentData = {
    type: txType,
    waterRefills: payload.waterRefills,
    collectionItems: payload.collectionItems,
    items: payload.items,
    refillItems: payload.refillItems,
  };
  const { refillLabel, assetLabel } = buildRefillAndAsset(pseudoTx);
  return {
    transactionId: doc.id,
    referenceId: String(d.referenceId || doc.id),
    type: txType,
    typeLabel: humanTypeLabel(txType),
    refillLabel,
    assetLabel,
    scheduledAt: serializeSchedule(payload.scheduledAt),
    status: "pending",
    customerName: String(profile.name || d.customerName || "Customer"),
    source: "submission",
  };
}

function isTrackableSubmission(data: FirebaseFirestore.DocumentData): boolean {
  const status = String(data.status || "");
  if (!TRACKABLE_SUBMISSION_STATUSES.includes(status)) return false;
  const subType = String(data.submissionType || "") as RawSubmissionType;
  return TRACKABLE_SUBMISSION_TYPES.includes(subType);
}

function rowKey(row: PortalTrackSearchRow): string {
  return `${row.source}:${row.referenceId}`;
}

/**
 * Public track-order lookup: match by any of name, email, company, or phone;
 * return open transactions and pending portal raw_submissions.
 * @param {string} businessId Firestore business id.
 * @param {PortalTrackSearchFilters} filters At least one field with 2+ chars.
 * @param {number} [limit] Max rows returned.
 * @param {string} [scopedCustomerId] Verified portal customer (always included).
 */
export async function searchPortalTrackOrders(
  businessId: string,
  filters: PortalTrackSearchFilters,
  limit = 25,
  scopedCustomerId?: string,
): Promise<PortalTrackSearchRow[]> {
  const terms = activeSearchTerms(filters);
  if (terms.length === 0) {
    throw new Error("QUERY_TOO_SHORT");
  }

  const customersSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("customers")
    .limit(500)
    .get();

  const matchedCustomerIds = new Set<string>();
  if (scopedCustomerId) {
    matchedCustomerIds.add(scopedCustomerId);
  }
  for (const doc of customersSnap.docs) {
    if (contactMatchesFilters(doc.data(), filters)) {
      matchedCustomerIds.add(doc.id);
    }
  }

  const txCol = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions");
  const subCol = db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions");

  const results = new Map<string, PortalTrackSearchRow>();

  const addRow = (row: PortalTrackSearchRow) => {
    const key = rowKey(row);
    if (!results.has(key)) {
      results.set(key, row);
    }
  };

  const idList = [...matchedCustomerIds];
  for (let i = 0; i < idList.length; i += 10) {
    const batch = idList.slice(i, i + 10);
    if (batch.length === 0) continue;
    // Firestore allows only one `in` per query — filter status in memory.
    const snap = await txCol
      .where("customerId", "in", batch)
      .limit(Math.min(limit * 12, 120))
      .get();
    for (const doc of snap.docs) {
      if (!isTrackableTxStatus(doc.data())) continue;
      addRow(mapTxDoc(doc));
    }
    if (results.size >= limit) break;

    const subSnap = await subCol
      .where("customerId", "in", batch)
      .where("status", "==", "pending_review")
      .limit(limit)
      .get();
    for (const doc of subSnap.docs) {
      const data = doc.data();
      if (!isTrackableSubmission(data)) continue;
      addRow(mapSubmissionDoc(doc));
    }
    if (results.size >= limit) break;
  }

  const nameTerm = (filters.name || filters.q || "").trim();
  if (results.size < limit && nameTerm.length >= 2) {
    const nameSnap = await txCol
      .where("customerName", ">=", nameTerm)
      .where("customerName", "<=", nameTerm + "\uf8ff")
      .limit(Math.min(limit * 8, 80))
      .get();
    for (const doc of nameSnap.docs) {
      if (!isTrackableTxStatus(doc.data())) continue;
      addRow(mapTxDoc(doc));
    }
  }

  if (results.size < limit) {
    const pendingSnap = await subCol
      .where("status", "==", "pending_review")
      .limit(200)
      .get();
    for (const doc of pendingSnap.docs) {
      if (results.size >= limit) break;
      const data = doc.data();
      if (!isTrackableSubmission(data)) continue;
      if (!contactMatchesFilters(data, filters)) continue;
      addRow(mapSubmissionDoc(doc));
    }
  }

  return [...results.values()]
    .sort((a, b) => {
      const ta = a.scheduledAt || "";
      const tb = b.scheduledAt || "";
      return tb.localeCompare(ta);
    })
    .slice(0, limit);
}
