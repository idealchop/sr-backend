/**
 * Pure coalescing rules for analytics rebuilds (durable via the
 * `analytics_materialize_queue/{businessId}` doc, so they hold across
 * Cloud Functions instances).
 */

/** At most one rebuild per business per window. */
export const MATERIALIZE_COALESCE_WINDOW_MS = 3 * 60_000;
/** A crashed run releases its lease after this long. */
export const MATERIALIZE_LEASE_MS = 5 * 60_000;

export type MaterializeQueueState = {
  pending?: boolean;
  seq?: number;
  lastRunAtMs?: number | null;
  leaseUntilMs?: number | null;
  leaseId?: string | null;
};

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

/**
 * Normalizes a raw queue doc.
 * @param {Record<string, unknown> | undefined} raw Firestore data.
 * @return {MaterializeQueueState} Parsed state.
 */
export function parseMaterializeQueueDoc(
  raw: Record<string, unknown> | undefined,
): MaterializeQueueState {
  const data = raw ?? {};
  return {
    pending: data.pending === true,
    seq: Number(data.seq) || 0,
    lastRunAtMs: toMillis(data.lastRunAt),
    leaseUntilMs: toMillis(data.leaseUntil),
    leaseId: typeof data.leaseId === "string" ? data.leaseId : null,
  };
}

/**
 * True when a rebuild may start now: no live lease and the last run ended
 * at least one coalesce window ago.
 * @param {MaterializeQueueState} state Queue state.
 * @param {number} nowMs Clock.
 * @param {number} windowMs Coalesce window.
 * @return {boolean} Whether to start a run.
 */
export function canStartMaterializeRun(
  state: MaterializeQueueState,
  nowMs: number,
  windowMs = MATERIALIZE_COALESCE_WINDOW_MS,
): boolean {
  if (state.leaseUntilMs != null && state.leaseUntilMs > nowMs) return false;
  if (state.lastRunAtMs != null && nowMs - state.lastRunAtMs < windowMs) return false;
  return true;
}

/**
 * Earliest instant a deferred rebuild becomes eligible.
 * @param {MaterializeQueueState} state Queue state.
 * @param {number} windowMs Coalesce window.
 * @return {number} Epoch ms.
 */
export function nextEligibleRunAtMs(
  state: MaterializeQueueState,
  windowMs = MATERIALIZE_COALESCE_WINDOW_MS,
): number {
  const afterWindow = state.lastRunAtMs != null ? state.lastRunAtMs + windowMs : 0;
  const afterLease = state.leaseUntilMs ?? 0;
  return Math.max(afterWindow, afterLease);
}
