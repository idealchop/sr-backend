import type { Transaction } from "./transaction-service";

export class SyncConflictError extends Error {
  readonly code = "SYNC_CONFLICT";

  constructor(public readonly serverTransaction: Transaction) {
    super("Transaction changed on the server while offline.");
    this.name = "SyncConflictError";
  }
}

export function readTimestampMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date.getTime();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * OFF-02: reject stale offline patches when the server record advanced.
 */
export function assertNoSyncConflict(
  current: Pick<Transaction, "updatedAt">,
  updates: Partial<Transaction> & {
    baseUpdatedAt?: unknown;
    forceApply?: boolean;
  },
  fullCurrent: Transaction,
): void {
  if (updates.forceApply) return;

  const baseMs = readTimestampMs(updates.baseUpdatedAt);
  const serverMs = readTimestampMs(current.updatedAt);
  if (baseMs == null || serverMs == null) return;
  if (baseMs >= serverMs) return;

  throw new SyncConflictError(fullCurrent);
}

export function stripSyncConflictFields<T extends Record<string, unknown>>(
  updates: T,
): Partial<Transaction> {
  const { baseUpdatedAt: _b, forceApply: _f, ...rest } = updates;
  return rest as Partial<Transaction>;
}
