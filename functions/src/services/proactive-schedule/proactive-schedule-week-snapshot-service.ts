import { logger } from "firebase-functions";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";

/** Subcollection under `businesses/{businessId}`. */
export const PROACTIVE_SCHEDULE_WEEK_SNAPSHOTS =
  "proactive_schedule_week_snapshots";

/** Single active week map per business (overwritten on each generate). */
export const PROACTIVE_SCHEDULE_WEEK_CURRENT_DOC = "current";

/**
 * Retention: document is eligible for TTL / purge after this many days from `generatedAt`.
 * Firestore TTL policy (optional): enable on `expireAt` for this collection group.
 */
export const PROACTIVE_SCHEDULE_SNAPSHOT_TTL_DAYS = 14;

const MAX_SUGGESTION_ROWS = 400;
const RATIONALE_MAX = 200;
const MAX_LINE_ITEMS = 20;

function sanitizeSuggestionRow(
  row: ProactiveScheduleSuggestionInput,
): ProactiveScheduleSuggestionInput {
  const inventoryItems = Array.isArray(row.inventoryItems) ?
    row.inventoryItems.slice(0, MAX_LINE_ITEMS).map((line) => ({
      inventoryId: String(line.inventoryId).slice(0, 120),
      qty: Math.max(0, Number(line.qty) || 0),
    })) :
    undefined;

  return {
    id: String(row.id).slice(0, 120),
    customerId: String(row.customerId).slice(0, 120),
    customerName: String(row.customerName).slice(0, 200),
    scheduledDate: String(row.scheduledDate).slice(0, 40),
    kind: row.kind,
    refillItems: Array.isArray(row.refillItems) ?
      row.refillItems.slice(0, MAX_LINE_ITEMS).map((line) => ({
        type: String(line.type).slice(0, 80),
        qty: Math.max(0, Number(line.qty) || 0),
      })) :
      [],
    inventoryItems:
      inventoryItems && inventoryItems.length > 0 ? inventoryItems : undefined,
    returnContainers: Array.isArray(row.returnContainers) ?
      row.returnContainers.slice(0, MAX_LINE_ITEMS).map((line) => ({
        inventoryId: String(line.inventoryId).slice(0, 120),
        qty: Math.max(0, Number(line.qty) || 0),
      })) :
      [],
    rationale: String(row.rationale).slice(0, RATIONALE_MAX),
    ...(row.source === "profile" || row.source === "history" ? { source: row.source } : {}),
  };
}

export type ProactiveScheduleSuggestionInput = {
  id: string;
  customerId: string;
  customerName: string;
  scheduledDate: string;
  kind: "delivery" | "collection";
  refillItems: Array<{ type: string; qty: number }>;
  inventoryItems?: Array<{ inventoryId: string; qty: number; name?: string }>;
  returnContainers: Array<{ inventoryId: string; qty: number; name?: string }>;
  rationale: string;
  source?: "profile" | "history";
};

function snapshotDocRef(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection(PROACTIVE_SCHEDULE_WEEK_SNAPSHOTS)
    .doc(PROACTIVE_SCHEDULE_WEEK_CURRENT_DOC);
}

export type ProactiveScheduleWeekSnapshotDTO = {
  windowLabel: string;
  generatedAt: string;
  expireAt: string;
  suggestions: ProactiveScheduleSuggestionInput[];
};

export class ProactiveScheduleWeekSnapshotService {
  static async getLatest(
    businessId: string,
  ): Promise<ProactiveScheduleWeekSnapshotDTO | null> {
    const snap = await snapshotDocRef(businessId).get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    const expireAt = d?.expireAt as Timestamp | undefined;
    if (expireAt && expireAt.toMillis() < Date.now()) {
      return null;
    }
    const generatedAt = d?.generatedAt as Timestamp | undefined;
    const suggestions = Array.isArray(d?.suggestions) ? d.suggestions : [];
    return {
      windowLabel: typeof d?.windowLabel === "string" ? d.windowLabel : "",
      generatedAt: generatedAt ?
        generatedAt.toDate().toISOString() :
        new Date(0).toISOString(),
      expireAt: expireAt ? expireAt.toDate().toISOString() : "",
      suggestions: suggestions as ProactiveScheduleSuggestionInput[],
    };
  }

  static async upsert(
    businessId: string,
    payload: {
      windowLabel: string;
      suggestions: ProactiveScheduleSuggestionInput[];
    },
  ): Promise<void> {
    const rows = Array.isArray(payload.suggestions) ?
      payload.suggestions
        .slice(0, MAX_SUGGESTION_ROWS)
        .map(sanitizeSuggestionRow) :
      [];
    const now = Timestamp.now();
    const expireAt = Timestamp.fromMillis(
      now.toMillis() + PROACTIVE_SCHEDULE_SNAPSHOT_TTL_DAYS * 86400 * 1000,
    );

    await snapshotDocRef(businessId).set(
      {
        windowLabel: String(payload.windowLabel || "").slice(0, 500),
        suggestions: rows,
        generatedAt: now,
        expireAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false },
    );

    logger.info("proactive_schedule_week snapshot upserted", {
      businessId,
      rowCount: rows.length,
      ttlDays: PROACTIVE_SCHEDULE_SNAPSHOT_TTL_DAYS,
    });
  }

  // eslint-disable-next-line valid-jsdoc
  /** Scheduled job: delete expired snapshot docs (collection group). */
  static async deleteExpiredBatch(limit = 500): Promise<number> {
    const now = Timestamp.now();
    const q = await db
      .collectionGroup(PROACTIVE_SCHEDULE_WEEK_SNAPSHOTS)
      .where("expireAt", "<=", now)
      .limit(limit)
      .get();

    if (q.empty) return 0;

    const batch = db.batch();
    for (const doc of q.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    logger.info("proactive_schedule_week snapshots purged", { count: q.size });
    return q.size;
  }
}
