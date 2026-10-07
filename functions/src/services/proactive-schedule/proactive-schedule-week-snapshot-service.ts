import { logger } from "firebase-functions";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import type {
  ForecastAccuracySummary,
  ForecastPredictedItem,
  ForecastRecommendedAction,
} from "../../utils/forecast-accuracy";
import { addManilaDateKey } from "../../utils/philippine-datetime";

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
const MAX_LAST_WEEK_ROWS = 50;

function sanitizeLineItems(
  rows: unknown,
): ForecastPredictedItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_LINE_ITEMS).map((line) => {
    const o = (line || {}) as Record<string, unknown>;
    return {
      type: String(o.type || "").slice(0, 80),
      qty: Math.max(0, Number(o.qty) || 0),
    };
  });
}

function sanitizeInventoryLines(
  rows: unknown,
): Array<{ inventoryId: string; qty: number }> | undefined {
  if (!Array.isArray(rows)) return undefined;
  const out = rows.slice(0, MAX_LINE_ITEMS).map((line) => {
    const o = (line || {}) as Record<string, unknown>;
    return {
      inventoryId: String(o.inventoryId || "").slice(0, 120),
      qty: Math.max(0, Number(o.qty) || 0),
    };
  }).filter((line) => line.inventoryId);
  return out.length > 0 ? out : undefined;
}

function sanitizeOutcome(value: unknown): ProactiveScheduleSuggestionInput["outcome"] {
  if (value === "hit" || value === "missed" || value === "pending") return value;
  return undefined;
}

function sanitizeRecommendedAction(value: unknown): ForecastRecommendedAction | undefined {
  if (value === "save" || value === "call" || value === "either") return value;
  return undefined;
}

function sanitizeSuggestionRow(
  row: ProactiveScheduleSuggestionInput,
): ProactiveScheduleSuggestionInput {
  const inventoryItems = sanitizeInventoryLines(row.inventoryItems);
  const predictedItems = sanitizeLineItems(row.predictedItems || row.refillItems);
  const outcome = sanitizeOutcome(row.outcome);
  const recommendedAction = sanitizeRecommendedAction(row.recommendedAction);

  return {
    id: String(row.id).slice(0, 120),
    customerId: String(row.customerId).slice(0, 120),
    customerName: String(row.customerName).slice(0, 200),
    scheduledDate: String(row.scheduledDate).slice(0, 40),
    kind: row.kind,
    refillItems: predictedItems,
    inventoryItems,
    returnContainers: Array.isArray(row.returnContainers) ?
      row.returnContainers.slice(0, MAX_LINE_ITEMS).map((line) => ({
        inventoryId: String(line.inventoryId).slice(0, 120),
        qty: Math.max(0, Number(line.qty) || 0),
      })) :
      [],
    rationale: String(row.rationale).slice(0, RATIONALE_MAX),
    ...(typeof row.reason === "string" && row.reason.trim() ?
      { reason: String(row.reason).slice(0, RATIONALE_MAX) } :
      {}),
    ...(row.source === "profile" ||
      row.source === "history" ||
      row.source === "profile_delivery" ||
      row.source === "profile_collection" ?
      { source: row.source } :
      {}),
    ...(typeof row.customerPhone === "string" && row.customerPhone.trim() ?
      { customerPhone: String(row.customerPhone).slice(0, 40) } :
      {}),
    ...(typeof row.predictedDate === "string" ?
      { predictedDate: String(row.predictedDate).slice(0, 16) } :
      {}),
    ...(typeof row.predictedQty === "number" ?
      { predictedQty: Math.max(0, Number(row.predictedQty) || 0) } :
      { predictedQty: predictedItems.reduce((sum, line) => sum + line.qty, 0) }),
    predictedItems,
    ...(recommendedAction ? { recommendedAction } : {}),
    ...(outcome ? { outcome } : {}),
    ...(typeof row.calledAt === "string" && row.calledAt.trim() ?
      { calledAt: String(row.calledAt).slice(0, 40) } :
      {}),
    ...(typeof row.matchedTransactionId === "string" ?
      { matchedTransactionId: String(row.matchedTransactionId).slice(0, 120) } :
      {}),
    ...(typeof row.actualQty === "number" ? { actualQty: Math.max(0, Number(row.actualQty) || 0) } : {}),
    ...(typeof row.dateDeltaDays === "number" ? { dateDeltaDays: Number(row.dateDeltaDays) || 0 } : {}),
    ...(typeof row.qtyScore === "number" ? { qtyScore: Number(row.qtyScore) || 0 } : {}),
    ...(typeof row.productScore === "number" ? { productScore: Number(row.productScore) || 0 } : {}),
    ...(typeof row.overallScore === "number" ? { overallScore: Number(row.overallScore) || 0 } : {}),
    ...(Array.isArray(row.actualItems) ? { actualItems: sanitizeLineItems(row.actualItems) } : {}),
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
  reason?: string;
  source?: "profile" | "history" | "profile_delivery" | "profile_collection";
  customerPhone?: string;
  predictedDate?: string;
  predictedQty?: number;
  predictedItems?: ForecastPredictedItem[];
  recommendedAction?: ForecastRecommendedAction;
  outcome?: "pending" | "hit" | "missed";
  calledAt?: string;
  matchedTransactionId?: string;
  actualQty?: number;
  actualItems?: ForecastPredictedItem[];
  dateDeltaDays?: number;
  qtyScore?: number;
  productScore?: number;
  overallScore?: number;
};

export type ForecastLastWeekRow = {
  suggestionId: string;
  customerName: string;
  kind: "delivery" | "collection";
  predictedDate: string;
  actualDate?: string;
  predictedQty: number;
  actualQty?: number;
  predictedItems: ForecastPredictedItem[];
  actualItems?: ForecastPredictedItem[];
  qtyScore?: number;
  productScore?: number;
  overallScore?: number;
  outcome: "hit" | "missed";
};

export type ForecastLastWeekAccuracy = ForecastAccuracySummary & {
  generatedAt?: string;
  rows: ForecastLastWeekRow[];
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
  aiSummary?: string;
  suggestions: ProactiveScheduleSuggestionInput[];
  source?: "schedule_batch" | "generate_ai" | "client_put";
  windowStart?: string;
  windowEnd?: string;
  accuracySummary?: ForecastAccuracySummary;
  lastWeekAccuracy?: ForecastLastWeekAccuracy;
};

function sanitizeAccuracySummary(raw: unknown): ForecastAccuracySummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    hits: Math.max(0, Number(o.hits) || 0),
    misses: Math.max(0, Number(o.misses) || 0),
    avgOverallScore: Math.max(0, Number(o.avgOverallScore) || 0),
  };
}

function sanitizeLastWeekAccuracy(raw: unknown): ForecastLastWeekAccuracy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const summary = sanitizeAccuracySummary(raw);
  if (!summary) return undefined;
  const rows = Array.isArray(o.rows) ?
    o.rows.slice(0, MAX_LAST_WEEK_ROWS).map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        suggestionId: String(r.suggestionId || "").slice(0, 120),
        customerName: String(r.customerName || "").slice(0, 200),
        kind: r.kind === "collection" ? "collection" as const : "delivery" as const,
        predictedDate: String(r.predictedDate || "").slice(0, 16),
        ...(typeof r.actualDate === "string" ? { actualDate: String(r.actualDate).slice(0, 16) } : {}),
        predictedQty: Math.max(0, Number(r.predictedQty) || 0),
        ...(typeof r.actualQty === "number" ? { actualQty: Math.max(0, Number(r.actualQty) || 0) } : {}),
        predictedItems: sanitizeLineItems(r.predictedItems),
        ...(Array.isArray(r.actualItems) ? { actualItems: sanitizeLineItems(r.actualItems) } : {}),
        ...(typeof r.qtyScore === "number" ? { qtyScore: Number(r.qtyScore) || 0 } : {}),
        ...(typeof r.productScore === "number" ? { productScore: Number(r.productScore) || 0 } : {}),
        ...(typeof r.overallScore === "number" ? { overallScore: Number(r.overallScore) || 0 } : {}),
        outcome: r.outcome === "hit" ? "hit" as const : "missed" as const,
      };
    }) :
    [];
  return {
    ...summary,
    ...(typeof o.generatedAt === "string" ? { generatedAt: String(o.generatedAt).slice(0, 40) } : {}),
    rows,
  };
}

function mapSnapshotData(d: Record<string, unknown>): ProactiveScheduleWeekSnapshotDTO {
  const expireAt = d?.expireAt as Timestamp | undefined;
  const generatedAt = d?.generatedAt as Timestamp | undefined;
  const suggestions = Array.isArray(d?.suggestions) ? d.suggestions : [];
  const source =
    d?.source === "schedule_batch" || d?.source === "generate_ai" || d?.source === "client_put" ?
      d.source :
      undefined;
  return {
    windowLabel: typeof d?.windowLabel === "string" ? d.windowLabel : "",
    generatedAt: generatedAt ?
      generatedAt.toDate().toISOString() :
      new Date(0).toISOString(),
    expireAt: expireAt ? expireAt.toDate().toISOString() : "",
    aiSummary:
      typeof d?.aiSummary === "string" ? d.aiSummary.slice(0, 400) : undefined,
    suggestions: suggestions as ProactiveScheduleSuggestionInput[],
    source,
    ...(typeof d?.windowStart === "string" ? { windowStart: d.windowStart } : {}),
    ...(typeof d?.windowEnd === "string" ? { windowEnd: d.windowEnd } : {}),
    ...(sanitizeAccuracySummary(d?.accuracySummary) ?
      { accuracySummary: sanitizeAccuracySummary(d.accuracySummary) } :
      {}),
    ...(sanitizeLastWeekAccuracy(d?.lastWeekAccuracy) ?
      { lastWeekAccuracy: sanitizeLastWeekAccuracy(d.lastWeekAccuracy) } :
      {}),
  };
}

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
    return mapSnapshotData(d);
  }

  static async upsert(
    businessId: string,
    payload: {
      windowLabel: string;
      suggestions: ProactiveScheduleSuggestionInput[];
      aiSummary?: string;
      source?: ProactiveScheduleWeekSnapshotDTO["source"];
      windowStart?: string;
      windowEnd?: string;
      accuracySummary?: ForecastAccuracySummary;
      lastWeekAccuracy?: ForecastLastWeekAccuracy;
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
        ...(payload.aiSummary ? { aiSummary: payload.aiSummary.slice(0, 400) } : {}),
        ...(payload.source ? { source: payload.source } : {}),
        ...(payload.windowStart ? { windowStart: String(payload.windowStart).slice(0, 16) } : {}),
        ...(payload.windowEnd ? { windowEnd: String(payload.windowEnd).slice(0, 16) } : {}),
        ...(payload.accuracySummary ? { accuracySummary: payload.accuracySummary } : {}),
        ...(payload.lastWeekAccuracy ?
          { lastWeekAccuracy: sanitizeLastWeekAccuracy(payload.lastWeekAccuracy) } :
          {}),
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
      source: payload.source || "client_put",
    });
  }

  static async patchSuggestions(
    businessId: string,
    suggestions: ProactiveScheduleSuggestionInput[],
    extra?: {
      accuracySummary?: ForecastAccuracySummary;
    },
  ): Promise<void> {
    const rows = suggestions.slice(0, MAX_SUGGESTION_ROWS).map(sanitizeSuggestionRow);
    await snapshotDocRef(businessId).set(
      {
        suggestions: rows,
        ...(extra?.accuracySummary ? { accuracySummary: extra.accuracySummary } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  static lastWeekAccuracyFromSuggestions(
    suggestions: ProactiveScheduleSuggestionInput[],
    generatedAt: string,
  ): ForecastLastWeekAccuracy {
    const scored = suggestions.filter(
      (row): row is ProactiveScheduleSuggestionInput & { outcome: "hit" | "missed" } =>
        row.outcome === "hit" || row.outcome === "missed",
    );
    const summary = {
      hits: scored.filter((row) => row.outcome === "hit").length,
      misses: scored.filter((row) => row.outcome === "missed").length,
      avgOverallScore: 0,
    };
    const hitScores = scored
      .filter((row) => row.outcome === "hit")
      .map((row) => Number(row.overallScore) || 0);
    if (hitScores.length > 0) {
      summary.avgOverallScore = Math.round(
        hitScores.reduce((sum, n) => sum + n, 0) / hitScores.length,
      );
    }
    return {
      ...summary,
      generatedAt,
      rows: scored.slice(0, MAX_LAST_WEEK_ROWS).map((row) => ({
        suggestionId: row.id,
        customerName: row.customerName,
        kind: row.kind,
        predictedDate: row.predictedDate || row.scheduledDate.slice(0, 10),
        ...(typeof row.dateDeltaDays === "number" && (row.predictedDate || row.scheduledDate) ?
          {
            actualDate: addManilaDateKey(
              row.predictedDate || row.scheduledDate.slice(0, 10),
              row.dateDeltaDays,
            ),
          } :
          {}),
        predictedQty: row.predictedQty ??
          (row.predictedItems || row.refillItems).reduce((sum, line) => sum + line.qty, 0),
        actualQty: row.actualQty,
        predictedItems: row.predictedItems || row.refillItems,
        actualItems: row.actualItems,
        qtyScore: row.qtyScore,
        productScore: row.productScore,
        overallScore: row.overallScore,
        outcome: row.outcome,
      })),
    };
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
