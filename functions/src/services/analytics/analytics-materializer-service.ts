import { randomUUID } from "crypto";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService, type Customer } from "../customers/customer-service";
import { TransactionService, type Transaction } from "../transactions/transaction-service";
import { coerceToDate } from "../../utils/philippine-datetime";
import {
  ANALYTICS_DAILY_VERSION,
  ANALYTICS_MATERIALIZE_TX_LIMIT,
  ANALYTICS_SNAPSHOT_VERSION,
  buildAnalyticsDailyRollups,
  sumAnalyticsDailyRange,
  type AnalyticsDailyRollup,
} from "../../utils/analytics-daily-rollup";
import {
  ANALYTICS_STATE_VERSION,
  applyProjectionChanges,
  decodeProjectedRecord,
  orderProjectedDesc,
  projectCustomerRecord,
  projectTransactionRecord,
  recordsFromShards,
  shardRecords,
  type ProjectedRecord,
  type ProjectionShard,
} from "../../utils/analytics-ledger-projection";
import {
  computeAnalyticsMaterialization,
  diffDailyRollups,
  emptyDailyRollup,
  resolveDormantThresholdDays,
  type DashboardKpiSnapshotBody,
} from "./analytics-materialize-compute";
import {
  MATERIALIZE_LEASE_MS,
  canStartMaterializeRun,
  parseMaterializeQueueDoc,
} from "./analytics-materialize-coalesce";

export type {
  AnalyticsPresetId,
  AnalyticsPresetSummary,
} from "./analytics-materialize-compute";

export const DASHBOARD_KPIS_DOC_ID = "dashboard_kpis";
/** Top-level queue: one doc per business with pending mutations (Admin SDK only). */
export const ANALYTICS_MATERIALIZE_QUEUE_COLLECTION = "analytics_materialize_queue";
/** businesses/{id}/analytics_state — compact ledger projection (Admin SDK only). */
export const ANALYTICS_STATE_COLLECTION = "analytics_state";

/** Incremental projection limits; above these a business uses coalesced full recounts. */
export const PROJECTION_MAX_TX = 12_000;
export const PROJECTION_MAX_CUSTOMERS = 8_000;
export const TX_STATE_SHARDS = 16;
export const CUSTOMER_STATE_SHARDS = 4;
/** Firestore doc limit is 1 MiB; keep headroom for field names/metadata. */
export const STATE_SHARD_MAX_BYTES = 900_000;
/** Re-read docs updated this long before the last checkpoint (clock skew, late commits). */
export const CHECKPOINT_OVERLAP_MS = 2 * 60_000;
export const CHANGED_DOCS_PAGE = 300;
/** More changed docs than this in one window → full recount is cheaper/safer. */
export const CHANGED_DOCS_MAX = 1_500;

export type DashboardKpiSnapshotDoc = DashboardKpiSnapshotBody & {
  computedAt: ReturnType<typeof FieldValue.serverTimestamp> | Date;
  version: number;
  reason?: string;
};

export type MaterializeMode = "incremental" | "full";

export type MaterializeResult = {
  businessId: string;
  mode: MaterializeMode;
  /** What actually ran ("full" when incremental fell back). */
  path: MaterializeMode;
  fallbackReason?: string;
  daysWritten: number;
  coverageTxCount: number;
  changedTransactions?: number;
  changedCustomers?: number;
};

type StateMeta = {
  version: number;
  disabled?: boolean;
  disabledReason?: string;
  txShardCount: number;
  customerShardCount: number;
  txCount: number;
  customerCount: number;
  checkpointMs: number;
};

type LoadedState = {
  meta: StateMeta;
  txRecords: Map<string, ProjectedRecord>;
  customerRecords: Map<string, ProjectedRecord>;
};

class StateTooLargeError extends Error {}

function txShardId(index: number): string {
  return `tx_${String(index).padStart(2, "0")}`;
}

function customerShardId(index: number): string {
  return `cust_${String(index).padStart(2, "0")}`;
}

function selectTransactionsForKpis(records: Iterable<ProjectedRecord>): Transaction[] {
  return orderProjectedDesc(records, "scheduledAt", ANALYTICS_MATERIALIZE_TX_LIMIT)
    .map((record) => decodeProjectedRecord<Transaction>(record));
}

function selectCustomersForKpis(records: Iterable<ProjectedRecord>): Customer[] {
  return orderProjectedDesc(records, "createdAt")
    .map((record) => decodeProjectedRecord<Customer>(record));
}

/**
 * Writes materialized analytics_daily + analytics_snapshots/dashboard_kpis.
 *
 * - Ledger mutations only enqueue (`scheduleMaterialize`); at most one rebuild
 *   per business per coalesce window runs (leading edge inline, trailing edge
 *   via the `processAnalyticsMaterializeQueue` scheduler).
 * - Incremental rebuilds read the compact `analytics_state` projection plus
 *   only docs changed since the checkpoint, then run the same KPI math.
 * - Nightly reconcile and manual refresh do a full recount (and rebuild state).
 */
export class AnalyticsMaterializerService {
  static dailyRef(businessId: string, dateKey: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_daily")
      .doc(dateKey);
  }

  static snapshotRef(businessId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_snapshots")
      .doc(DASHBOARD_KPIS_DOC_ID);
  }

  static stateRef(businessId: string, docId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection(ANALYTICS_STATE_COLLECTION)
      .doc(docId);
  }

  static queueRef(businessId: string) {
    return db.collection(ANALYTICS_MATERIALIZE_QUEUE_COLLECTION).doc(businessId);
  }

  /** Legacy dirty flag on the business doc (nightly still honors it). */
  static async markDirty(businessId: string): Promise<void> {
    if (!businessId) return;
    await db.collection("businesses").doc(businessId).set(
      {
        analyticsDirtyAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  static async clearDirty(businessId: string): Promise<void> {
    if (!businessId) return;
    await db.collection("businesses").doc(businessId).set(
      {
        analyticsDirtyAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /**
   * Fire-and-forget after ledger mutations. Records the mutation on the
   * durable queue doc; runs an incremental rebuild now only when the business
   * is outside its coalesce window, otherwise the scheduler picks it up.
   * @param {string} businessId Workspace id.
   * @param {Object} [options] deletedTransactionId for hard deletes.
   */
  static scheduleMaterialize(
    businessId: string,
    options: { deletedTransactionId?: string } = {},
  ): void {
    if (!businessId) return;
    void AnalyticsMaterializerService.enqueueMaterialize(businessId, options)
      .then((leaseId) =>
        leaseId ?
          AnalyticsMaterializerService.runLeasedMaterialize(businessId, leaseId, "mutate") :
          undefined,
      )
      .catch((error) => {
        logger.warn("scheduleMaterialize failed", { businessId, error });
      });
  }

  /**
   * Marks the queue doc pending and, when allowed, takes the run lease.
   * @param {string} businessId Workspace id.
   * @param {Object} options deletedTransactionId + clock override.
   * @return {Promise<string | null>} Lease id when the caller should run now.
   */
  static async enqueueMaterialize(
    businessId: string,
    options: { deletedTransactionId?: string; nowMs?: number } = {},
  ): Promise<string | null> {
    const ref = AnalyticsMaterializerService.queueRef(businessId);
    const baseUpdate = (nowMs: number): Record<string, unknown> => ({
      businessId,
      pending: true,
      seq: FieldValue.increment(1),
      lastMutationAt: Timestamp.fromMillis(nowMs),
      ...(options.deletedTransactionId ?
        { deletedTxIds: FieldValue.arrayUnion(options.deletedTransactionId) } :
        {}),
    });

    try {
      return await db.runTransaction(async (t) => {
        const nowMs = options.nowMs ?? Date.now();
        const snap = await t.get(ref);
        const state = parseMaterializeQueueDoc(snap.exists ? snap.data() : undefined);
        const runNow = canStartMaterializeRun(state, nowMs);
        const leaseId = runNow ? randomUUID() : null;
        t.set(
          ref,
          {
            ...baseUpdate(nowMs),
            ...(leaseId ?
              {
                leaseId,
                leaseUntil: Timestamp.fromMillis(nowMs + MATERIALIZE_LEASE_MS),
              } :
              {}),
          },
          { merge: true },
        );
        return leaseId;
      });
    } catch (error) {
      // Contention: never lose the pending mark; the scheduler will run it.
      logger.warn("enqueueMaterialize transaction failed; marking pending only", {
        businessId,
        error,
      });
      await ref.set(baseUpdate(options.nowMs ?? Date.now()), { merge: true });
      return null;
    }
  }

  /**
   * Takes the lease for a pending business if its window allows (scheduler path).
   * @param {string} businessId Workspace id.
   * @param {number} nowMs Clock.
   * @return {Promise<string | null>} Lease id or null.
   */
  static async tryAcquireMaterializeLease(
    businessId: string,
    nowMs = Date.now(),
  ): Promise<string | null> {
    const ref = AnalyticsMaterializerService.queueRef(businessId);
    return db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return null;
      const state = parseMaterializeQueueDoc(snap.data());
      if (!state.pending || !canStartMaterializeRun(state, nowMs)) return null;
      const leaseId = randomUUID();
      t.set(
        ref,
        { leaseId, leaseUntil: Timestamp.fromMillis(nowMs + MATERIALIZE_LEASE_MS) },
        { merge: true },
      );
      return leaseId;
    });
  }

  /**
   * Runs one incremental rebuild under a lease, then releases it. Mutations
   * that arrived during the run keep `pending` true for the next window.
   * @param {string} businessId Workspace id.
   * @param {string} leaseId Lease taken by enqueue/scheduler.
   * @param {string} reason Log/snapshot reason.
   * @param {number} [nowMs] Clock override (tests).
   * @return {Promise<MaterializeResult | null>} Result or null if lease lost.
   */
  static async runLeasedMaterialize(
    businessId: string,
    leaseId: string,
    reason: string,
    nowMs?: number,
  ): Promise<MaterializeResult | null> {
    const ref = AnalyticsMaterializerService.queueRef(businessId);
    const startSnap = await ref.get();
    const startData = startSnap.data() ?? {};
    if (startData.leaseId !== leaseId) return null;
    const seqAtStart = Number(startData.seq) || 0;
    const deletedIds: string[] = Array.isArray(startData.deletedTxIds) ?
      startData.deletedTxIds.filter((id: unknown): id is string => typeof id === "string") :
      [];

    let result: MaterializeResult | null = null;
    let failed = false;
    try {
      result = await AnalyticsMaterializerService.materialize(businessId, {
        mode: "incremental",
        reason,
        deletedTransactionIds: deletedIds,
        now: nowMs != null ? new Date(nowMs) : undefined,
      });
    } catch (error) {
      failed = true;
      logger.warn("analytics leased materialize failed", { businessId, reason, error });
    }

    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const data = snap.data() ?? {};
      if (data.leaseId !== leaseId) return;
      const seqNow = Number(data.seq) || 0;
      const update: Record<string, unknown> = {
        lastRunAt: Timestamp.fromMillis(nowMs ?? Date.now()),
        leaseId: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        pending: failed || seqNow !== seqAtStart,
      };
      if (!failed && deletedIds.length > 0) {
        update.deletedTxIds = FieldValue.arrayRemove(...deletedIds);
      }
      if (!failed) update.lastResultPath = result?.path ?? null;
      t.set(ref, update, { merge: true });
    });

    return result;
  }

  /**
   * Rebuild stock snapshot and daily docs.
   * `full` re-reads the ledger (nightly / manual refresh) and reseeds state;
   * `incremental` reads state + changed docs and falls back to full when the
   * state is missing, stale, or inconsistent with live counts.
   * @param {string} businessId Workspace id.
   * @param {Object} options mode + reason.
   * @return {Promise<MaterializeResult>} Outcome summary.
   */
  static async materialize(
    businessId: string,
    options: {
      mode?: MaterializeMode;
      reason?: string;
      now?: Date;
      deletedTransactionIds?: string[];
    } = {},
  ): Promise<MaterializeResult> {
    const mode = options.mode ?? "incremental";
    const reason = options.reason ?? mode;
    const now = options.now ?? new Date();

    if (mode === "incremental") {
      const outcome = await AnalyticsMaterializerService.materializeIncremental(
        businessId,
        reason,
        now,
        options.deletedTransactionIds ?? [],
      );
      if (outcome.kind === "done") return outcome.result;
      logger.info("analytics incremental fell back to full", {
        businessId,
        reason,
        fallbackReason: outcome.fallbackReason,
      });
      const full = await AnalyticsMaterializerService.materializeFull(businessId, reason, now);
      return { ...full, mode, fallbackReason: outcome.fallbackReason };
    }

    return AnalyticsMaterializerService.materializeFull(businessId, reason, now);
  }

  private static async materializeFull(
    businessId: string,
    reason: string,
    now: Date,
  ): Promise<MaterializeResult> {
    const businessRef = db.collection("businesses").doc(businessId);
    const txCol = businessRef.collection("transactions");
    const customerCol = businessRef.collection("customers");

    const [businessSnap, txCountSnap, customerCountSnap] = await Promise.all([
      businessRef.get(),
      txCol.count().get(),
      customerCol.count().get(),
    ]);
    const txTotal = Number(txCountSnap.data().count) || 0;
    const customerTotal = Number(customerCountSnap.data().count) || 0;
    const projectionAllowed =
      txTotal <= PROJECTION_MAX_TX && customerTotal <= PROJECTION_MAX_CUSTOMERS;

    let customers: Customer[];
    let transactions: Transaction[];
    let txRecords: Map<string, ProjectedRecord> | null = null;
    let customerRecords: Map<string, ProjectedRecord> | null = null;

    if (projectionAllowed) {
      // Read every doc once; derive the exact Firestore orderBy/limit views in memory.
      const [txSnap, customerSnap] = await Promise.all([txCol.get(), customerCol.get()]);
      const rawTx = new Map<string, Record<string, unknown>>();
      txRecords = new Map();
      for (const doc of txSnap.docs) {
        const data = doc.data() as Record<string, unknown>;
        rawTx.set(doc.id, data);
        txRecords.set(doc.id, projectTransactionRecord(doc.id, data));
      }
      const rawCustomers = new Map<string, Record<string, unknown>>();
      customerRecords = new Map();
      for (const doc of customerSnap.docs) {
        const data = doc.data() as Record<string, unknown>;
        rawCustomers.set(doc.id, data);
        customerRecords.set(doc.id, projectCustomerRecord(doc.id, data));
      }
      transactions = orderProjectedDesc(
        txRecords.values(),
        "scheduledAt",
        ANALYTICS_MATERIALIZE_TX_LIMIT,
      ).map((r) => ({ id: r.docId, ...rawTx.get(r.docId) }) as Transaction);
      customers = orderProjectedDesc(customerRecords.values(), "createdAt")
        .map((r) => ({ id: r.docId, ...rawCustomers.get(r.docId) }) as Customer);
    } else {
      [customers, transactions] = await Promise.all([
        CustomerService.getCustomersByBusiness(businessId),
        TransactionService.getTransactionsByBusiness(businessId, {
          limit: ANALYTICS_MATERIALIZE_TX_LIMIT,
        }),
      ]);
    }

    const thresholdDays = resolveDormantThresholdDays(businessSnap.data()?.uiConfig);
    const { snapshot, dailyMap } = computeAnalyticsMaterialization(customers, transactions, {
      thresholdDays,
      now,
    });

    // Days that lost all activity since the previous projection are zeroed
    // (the legacy recount left their stale sums in analytics_daily).
    const zeroedDays: AnalyticsDailyRollup[] = [];
    if (txRecords && transactions.length < ANALYTICS_MATERIALIZE_TX_LIMIT) {
      const previous = await AnalyticsMaterializerService.loadState(businessId);
      if (previous.ok) {
        const beforeDaily = buildAnalyticsDailyRollups(
          selectTransactionsForKpis(previous.state.txRecords.values()),
          null,
        );
        for (const dateKey of beforeDaily.keys()) {
          if (!dailyMap.has(dateKey)) zeroedDays.push(emptyDailyRollup(dateKey));
        }
      }
    }

    const writer = db.bulkWriter();
    let daysWritten = 0;
    for (const rollup of [...dailyMap.values(), ...zeroedDays]) {
      daysWritten += 1;
      AnalyticsMaterializerService.writeDaily(writer, businessId, rollup);
    }
    AnalyticsMaterializerService.writeSnapshot(writer, businessId, snapshot, reason);

    if (txRecords && customerRecords) {
      try {
        AnalyticsMaterializerService.writeState(writer, businessId, {
          txRecords,
          customerRecords,
          dirtyTxShards: null,
          dirtyCustomerShards: null,
          checkpointMs: now.getTime(),
        });
      } catch (error) {
        if (!(error instanceof StateTooLargeError)) throw error;
        AnalyticsMaterializerService.writeDisabledMeta(writer, businessId, "shard_too_large");
      }
    } else {
      AnalyticsMaterializerService.writeDisabledMeta(writer, businessId, "ledger_too_large");
    }

    await writer.close();
    if (businessSnap.data()?.analyticsDirtyAt != null) {
      await AnalyticsMaterializerService.clearDirty(businessId);
    }

    logger.info("analytics materialize complete", {
      businessId,
      mode: "full",
      reason,
      daysWritten,
      coverageTxCount: transactions.length,
      projection: Boolean(txRecords),
    });

    return {
      businessId,
      mode: "full",
      path: "full",
      daysWritten,
      coverageTxCount: transactions.length,
    };
  }

  private static async materializeIncremental(
    businessId: string,
    reason: string,
    now: Date,
    deletedTransactionIds: string[],
  ): Promise<
    | { kind: "done"; result: MaterializeResult }
    | { kind: "fallback"; fallbackReason: string }
  > {
    const state = await AnalyticsMaterializerService.loadState(businessId);
    if (!state.ok) return { kind: "fallback", fallbackReason: state.reason };
    const { meta, txRecords, customerRecords } = state.state;

    const businessRef = db.collection("businesses").doc(businessId);
    const since = Timestamp.fromMillis(meta.checkpointMs - CHECKPOINT_OVERLAP_MS);
    const [changedTx, changedCustomers] = await Promise.all([
      AnalyticsMaterializerService.readChangedSince(businessRef.collection("transactions"), since),
      AnalyticsMaterializerService.readChangedSince(businessRef.collection("customers"), since),
    ]);
    if (!changedTx || !changedCustomers) {
      return { kind: "fallback", fallbackReason: "changed_overflow" };
    }

    const beforeTxs = selectTransactionsForKpis(txRecords.values());
    const beforeDaily = buildAnalyticsDailyRollups(beforeTxs, null);

    const dirtyTxShards = applyProjectionChanges(
      txRecords,
      changedTx.map((doc) => projectTransactionRecord(doc.id, doc.data)),
      deletedTransactionIds,
      meta.txShardCount,
    );
    const dirtyCustomerShards = applyProjectionChanges(
      customerRecords,
      changedCustomers.map((doc) => projectCustomerRecord(doc.id, doc.data)),
      [],
      meta.customerShardCount,
    );

    const [businessSnap, txCountSnap, customerCountSnap] = await Promise.all([
      businessRef.get(),
      businessRef.collection("transactions").count().get(),
      businessRef.collection("customers").count().get(),
    ]);
    const txTotal = Number(txCountSnap.data().count) || 0;
    const customerTotal = Number(customerCountSnap.data().count) || 0;
    // Hard deletes/creates we did not see (other code paths, string updatedAt) → recount.
    if (txTotal !== txRecords.size || customerTotal !== customerRecords.size) {
      return { kind: "fallback", fallbackReason: "count_mismatch" };
    }
    if (txTotal > PROJECTION_MAX_TX || customerTotal > PROJECTION_MAX_CUSTOMERS) {
      return { kind: "fallback", fallbackReason: "projection_limit" };
    }

    const transactions = selectTransactionsForKpis(txRecords.values());
    const customers = selectCustomersForKpis(customerRecords.values());
    const thresholdDays = resolveDormantThresholdDays(businessSnap.data()?.uiConfig);
    const { snapshot, dailyMap } = computeAnalyticsMaterialization(customers, transactions, {
      thresholdDays,
      now,
    });

    const capped = transactions.length >= ANALYTICS_MATERIALIZE_TX_LIMIT;
    const changedDays = diffDailyRollups(beforeDaily, dailyMap).filter(
      // When the 8k window slides, old days fall out of memory; keep their stored docs.
      (rollup) => !capped || dailyMap.has(rollup.dateKey),
    );

    const writer = db.bulkWriter();
    for (const rollup of changedDays) {
      AnalyticsMaterializerService.writeDaily(writer, businessId, rollup);
    }
    AnalyticsMaterializerService.writeSnapshot(writer, businessId, snapshot, reason);
    try {
      AnalyticsMaterializerService.writeState(writer, businessId, {
        txRecords,
        customerRecords,
        dirtyTxShards,
        dirtyCustomerShards,
        checkpointMs: now.getTime(),
      });
    } catch (error) {
      if (!(error instanceof StateTooLargeError)) throw error;
      await writer.close();
      return { kind: "fallback", fallbackReason: "shard_too_large" };
    }
    await writer.close();

    logger.info("analytics materialize complete", {
      businessId,
      mode: "incremental",
      reason,
      daysWritten: changedDays.length,
      coverageTxCount: transactions.length,
      changedTransactions: changedTx.length,
      changedCustomers: changedCustomers.length,
      deletedTransactions: deletedTransactionIds.length,
    });

    return {
      kind: "done",
      result: {
        businessId,
        mode: "incremental",
        path: "incremental",
        daysWritten: changedDays.length,
        coverageTxCount: transactions.length,
        changedTransactions: changedTx.length,
        changedCustomers: changedCustomers.length,
      },
    };
  }

  /**
   * Docs with `updatedAt >= since`, paged with limit(); null when over the cap.
   * Single-field range + orderBy on one field → automatic index, no composite.
   */
  private static async readChangedSince(
    col: FirebaseFirestore.CollectionReference,
    since: FirebaseFirestore.Timestamp,
  ): Promise<{ id: string; data: Record<string, unknown> }[] | null> {
    const out: { id: string; data: Record<string, unknown> }[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = col.where("updatedAt", ">=", since).orderBy("updatedAt", "asc");
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.limit(CHANGED_DOCS_PAGE).get();
      for (const doc of snap.docs) {
        out.push({ id: doc.id, data: doc.data() as Record<string, unknown> });
      }
      if (out.length > CHANGED_DOCS_MAX) return null;
      if (snap.docs.length < CHANGED_DOCS_PAGE) return out;
      cursor = snap.docs[snap.docs.length - 1];
    }
  }

  private static async loadState(
    businessId: string,
  ): Promise<{ ok: true; state: LoadedState } | { ok: false; reason: string }> {
    const metaSnap = await AnalyticsMaterializerService.stateRef(businessId, "meta").get();
    if (!metaSnap.exists) return { ok: false, reason: "state_missing" };
    const raw = metaSnap.data() ?? {};
    if (raw.disabled === true) {
      return { ok: false, reason: `state_disabled_${String(raw.disabledReason ?? "unknown")}` };
    }
    const checkpoint = coerceToDate(raw.checkpointAt);
    const meta: StateMeta = {
      version: Number(raw.version) || 0,
      txShardCount: Number(raw.txShardCount) || 0,
      customerShardCount: Number(raw.customerShardCount) || 0,
      txCount: Number(raw.txCount) || 0,
      customerCount: Number(raw.customerCount) || 0,
      checkpointMs: checkpoint ? checkpoint.getTime() : NaN,
    };
    if (
      meta.version !== ANALYTICS_STATE_VERSION ||
      meta.txShardCount !== TX_STATE_SHARDS ||
      meta.customerShardCount !== CUSTOMER_STATE_SHARDS ||
      !Number.isFinite(meta.checkpointMs)
    ) {
      return { ok: false, reason: "state_version" };
    }

    const refs = [
      ...Array.from({ length: meta.txShardCount }, (_, i) =>
        AnalyticsMaterializerService.stateRef(businessId, txShardId(i))),
      ...Array.from({ length: meta.customerShardCount }, (_, i) =>
        AnalyticsMaterializerService.stateRef(businessId, customerShardId(i))),
    ];
    const snaps = await db.getAll(...refs);
    const shards: ProjectionShard[] = [];
    for (const snap of snaps) {
      if (!snap.exists) return { ok: false, reason: "state_shard_missing" };
      try {
        shards.push(JSON.parse(String(snap.data()?.payload ?? "{}")) as ProjectionShard);
      } catch {
        return { ok: false, reason: "state_shard_corrupt" };
      }
    }
    const txRecords = recordsFromShards(shards.slice(0, meta.txShardCount));
    const customerRecords = recordsFromShards(shards.slice(meta.txShardCount));
    if (txRecords.size !== meta.txCount || customerRecords.size !== meta.customerCount) {
      return { ok: false, reason: "state_count" };
    }
    return { ok: true, state: { meta, txRecords, customerRecords } };
  }

  private static writeState(
    writer: FirebaseFirestore.BulkWriter,
    businessId: string,
    input: {
      txRecords: Map<string, ProjectedRecord>;
      customerRecords: Map<string, ProjectedRecord>;
      /** null = rewrite every shard. */
      dirtyTxShards: Set<number> | null;
      dirtyCustomerShards: Set<number> | null;
      checkpointMs: number;
    },
  ): void {
    const txShards = shardRecords(input.txRecords.values(), TX_STATE_SHARDS);
    const customerShards = shardRecords(input.customerRecords.values(), CUSTOMER_STATE_SHARDS);
    const pending: { id: string; payload: string }[] = [];
    txShards.forEach((shard, i) => {
      if (input.dirtyTxShards && !input.dirtyTxShards.has(i)) return;
      pending.push({ id: txShardId(i), payload: JSON.stringify(shard) });
    });
    customerShards.forEach((shard, i) => {
      if (input.dirtyCustomerShards && !input.dirtyCustomerShards.has(i)) return;
      pending.push({ id: customerShardId(i), payload: JSON.stringify(shard) });
    });
    // Validate every shard before queueing any write.
    for (const shard of [...txShards, ...customerShards]) {
      if (Buffer.byteLength(JSON.stringify(shard), "utf8") > STATE_SHARD_MAX_BYTES) {
        throw new StateTooLargeError("analytics_state shard too large");
      }
    }
    for (const { id, payload } of pending) {
      writer.set(AnalyticsMaterializerService.stateRef(businessId, id), { payload });
    }
    writer.set(AnalyticsMaterializerService.stateRef(businessId, "meta"), {
      version: ANALYTICS_STATE_VERSION,
      txShardCount: TX_STATE_SHARDS,
      customerShardCount: CUSTOMER_STATE_SHARDS,
      txCount: input.txRecords.size,
      customerCount: input.customerRecords.size,
      checkpointAt: Timestamp.fromMillis(input.checkpointMs),
      builtAt: FieldValue.serverTimestamp(),
    });
  }

  private static writeDisabledMeta(
    writer: FirebaseFirestore.BulkWriter,
    businessId: string,
    disabledReason: string,
  ): void {
    writer.set(AnalyticsMaterializerService.stateRef(businessId, "meta"), {
      version: ANALYTICS_STATE_VERSION,
      disabled: true,
      disabledReason,
      builtAt: FieldValue.serverTimestamp(),
    });
  }

  private static writeDaily(
    writer: FirebaseFirestore.BulkWriter,
    businessId: string,
    rollup: AnalyticsDailyRollup,
  ): void {
    writer.set(
      AnalyticsMaterializerService.dailyRef(businessId, rollup.dateKey),
      {
        ...rollup,
        computedAt: FieldValue.serverTimestamp(),
        version: ANALYTICS_DAILY_VERSION,
      },
      { merge: true },
    );
  }

  private static writeSnapshot(
    writer: FirebaseFirestore.BulkWriter,
    businessId: string,
    body: DashboardKpiSnapshotBody,
    reason: string,
  ): void {
    const snapshot: DashboardKpiSnapshotDoc = {
      ...body,
      computedAt: FieldValue.serverTimestamp(),
      version: ANALYTICS_SNAPSHOT_VERSION,
      reason,
    };
    writer.set(AnalyticsMaterializerService.snapshotRef(businessId), snapshot, { merge: true });
  }

  /**
   * Sum stored analytics_daily docs for a Manila date range.
   * Falls back to materializing from ledger when docs are missing.
   * @param {string} businessId Workspace id.
   * @param {string} fromKey Inclusive yyyy-MM-dd.
   * @param {string} toKey Inclusive yyyy-MM-dd.
   * @return {Promise<Object>} Range sum + source.
   */
  static async sumDailyRange(
    businessId: string,
    fromKey: string,
    toKey: string,
  ): Promise<{
    from: string;
    to: string;
    dayCount: number;
    revenueTotal: number;
    revenueCash: number;
    revenueOnline: number;
    expensesTotal: number;
    fulfilledCount: number;
    netTotal: number;
    source: "analytics_daily" | "ledger_fallback";
    missingDays: number;
  }> {
    if (fromKey > toKey) {
      return AnalyticsMaterializerService.sumDailyRange(businessId, toKey, fromKey);
    }

    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("analytics_daily")
      .where("__name__", ">=", fromKey)
      .where("__name__", "<=", toKey)
      .get();

    const days: AnalyticsDailyRollup[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        dateKey: doc.id,
        revenueTotal: Number(data.revenueTotal) || 0,
        revenueCash: Number(data.revenueCash) || 0,
        revenueOnline: Number(data.revenueOnline) || 0,
        expensesTotal: Number(data.expensesTotal) || 0,
        fulfilledCount: Number(data.fulfilledCount) || 0,
        paymentCount: Number(data.paymentCount) || 0,
      };
    });

    const expectedDays = (() => {
      let count = 0;
      const cursor = new Date(`${fromKey}T12:00:00+08:00`);
      const end = new Date(`${toKey}T12:00:00+08:00`);
      while (cursor.getTime() <= end.getTime()) {
        count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return count;
    })();

    const missingDays = Math.max(0, expectedDays - days.length);
    // Prefer stored docs when at least half the window is present (partial OK).
    if (days.length > 0 && missingDays <= expectedDays / 2) {
      return {
        ...sumAnalyticsDailyRange(days, fromKey, toKey),
        source: "analytics_daily",
        missingDays,
      };
    }

    const transactions = await TransactionService.getTransactionsByBusiness(businessId, {
      limit: ANALYTICS_MATERIALIZE_TX_LIMIT,
    });
    const rollups = buildAnalyticsDailyRollups(transactions, null);
    return {
      ...sumAnalyticsDailyRange(rollups.values(), fromKey, toKey),
      source: "ledger_fallback",
      missingDays: expectedDays,
    };
  }

  /**
   * Read stock snapshot doc if present.
   * @param {string} businessId Workspace id.
   * @return {Promise<Object | null>} Snapshot JSON or null.
   */
  static async getDashboardSnapshot(businessId: string): Promise<Record<string, unknown> | null> {
    const snap = await AnalyticsMaterializerService.snapshotRef(businessId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const computedAt = coerceToDate(data.computedAt);
    return {
      businessId,
      ...data,
      computedAt: computedAt ? computedAt.toISOString() : null,
    };
  }
}
