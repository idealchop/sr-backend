import { describe, expect, it } from "vitest";
import {
  assertNoSyncConflict,
  SyncConflictError,
} from "../../../services/transactions/sync-conflict";

describe("sync-conflict (OFF-02)", () => {
  it("allows patch when baseUpdatedAt matches server", () => {
    expect(() =>
      assertNoSyncConflict(
        { updatedAt: "2026-06-25T10:00:00.000Z" },
        { baseUpdatedAt: "2026-06-25T10:00:00.000Z", deliveryStatus: "in-transit" },
        { id: "tx-1", updatedAt: "2026-06-25T10:00:00.000Z" } as never,
      ),
    ).not.toThrow();
  });

  it("throws when server advanced after offline edit", () => {
    expect(() =>
      assertNoSyncConflict(
        { updatedAt: "2026-06-25T12:00:00.000Z" },
        { baseUpdatedAt: "2026-06-25T10:00:00.000Z", deliveryStatus: "completed" },
        { id: "tx-1", updatedAt: "2026-06-25T12:00:00.000Z" } as never,
      ),
    ).toThrow(SyncConflictError);
  });

  it("skips check when forceApply is set", () => {
    expect(() =>
      assertNoSyncConflict(
        { updatedAt: "2026-06-25T12:00:00.000Z" },
        {
          baseUpdatedAt: "2026-06-25T10:00:00.000Z",
          forceApply: true,
          deliveryStatus: "completed",
        },
        { id: "tx-1", updatedAt: "2026-06-25T12:00:00.000Z" } as never,
      ),
    ).not.toThrow();
  });
});
