import { describe, expect, it } from "vitest";
import {
  assignmentHistoryDocId,
  dedupeAssignmentHistory,
  extraAssignmentIdsToDelete,
} from "../../../../services/inventory/assignment-history";

describe("assignmentHistoryDocId", () => {
  it("keeps possess and return as separate docs", () => {
    expect(assignmentHistoryDocId("tx-1", "inv-round", "possess")).not.toBe(
      assignmentHistoryDocId("tx-1", "inv-round", "return"),
    );
  });
});

describe("dedupeAssignmentHistory", () => {
  it("keeps possess and return on the same ticket", () => {
    const pos = assignmentHistoryDocId("tx-1", "round", "possess");
    const ret = assignmentHistoryDocId("tx-1", "round", "return");
    const rows = [
      { id: "blob", inventoryItemId: "round", quantityAssigned: 7 },
      {
        id: "dup",
        transactionId: "tx-1",
        inventoryItemId: "round",
        quantityAssigned: 5,
        movement: "possess" as const,
      },
      {
        id: pos,
        transactionId: "tx-1",
        inventoryItemId: "round",
        quantityAssigned: 5,
        movement: "possess" as const,
      },
      {
        id: ret,
        transactionId: "tx-1",
        inventoryItemId: "round",
        quantityAssigned: -3,
        movement: "return" as const,
      },
    ];
    const deduped = dedupeAssignmentHistory(rows);
    expect(deduped.map((row) => row.id).sort()).toEqual([pos, ret].sort());
  });
});

describe("extraAssignmentIdsToDelete", () => {
  it("deletes collapsed ticket rows and net blobs", () => {
    const wanted = new Set([
      assignmentHistoryDocId("tx-1", "round", "possess"),
      assignmentHistoryDocId("tx-1", "round", "return"),
    ]);
    const extra = extraAssignmentIdsToDelete(
      [
        { id: "blob", inventoryItemId: "round", quantityAssigned: 7 },
        {
          id: "old-net",
          transactionId: "tx-1",
          inventoryItemId: "round",
          quantityAssigned: -3,
        },
        {
          id: assignmentHistoryDocId("tx-1", "round", "possess"),
          transactionId: "tx-1",
          inventoryItemId: "round",
          quantityAssigned: 5,
          movement: "possess",
        },
        {
          id: assignmentHistoryDocId("tx-1", "round", "return"),
          transactionId: "tx-1",
          inventoryItemId: "round",
          quantityAssigned: -3,
          movement: "return",
        },
      ],
      wanted,
    );
    expect(extra.sort()).toEqual(["blob", "old-net"].sort());
  });
});
