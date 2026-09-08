export type AssignmentMovement = "possess" | "return";

export function assignmentHistoryDocId(
  transactionId: string,
  inventoryItemId: string,
  movement: AssignmentMovement = "possess",
): string {
  const tx = String(transactionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  const item = String(inventoryItemId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
  const kind = movement === "return" ? "ret" : "pos";
  return `ord_${tx}_${item}_${kind}`.slice(0, 140);
}

export type AssignmentHistoryRow = {
  id?: string;
  transactionId?: string;
  inventoryItemId: string;
  quantityAssigned?: number;
  movement?: AssignmentMovement;
  date?: unknown;
};

function movementOf(row: AssignmentHistoryRow): AssignmentMovement {
  if (row.movement === "return" || (row.quantityAssigned || 0) < 0) {
    return "return";
  }
  return "possess";
}

/**
 * One row per order + container + possess/return.
 * Drops unkeyed net blobs and extra copies of the same ticket line.
 */
export function dedupeAssignmentHistory<T extends AssignmentHistoryRow>(
  rows: T[],
): T[] {
  const keyed = new Map<string, T>();
  const unkeyed: T[] = [];

  for (const row of rows) {
    const tx = String(row.transactionId || "").trim();
    if (!tx || !row.inventoryItemId) {
      unkeyed.push(row);
      continue;
    }
    const movement = movementOf(row);
    const key = `${tx}:${row.inventoryItemId}:${movement}`;
    const canonical = assignmentHistoryDocId(tx, row.inventoryItemId, movement);
    const prev = keyed.get(key);
    if (!prev || row.id === canonical) {
      keyed.set(key, row);
    }
  }

  const keyedRows = [...keyed.values()];
  const keyedItems = new Set(keyedRows.map((row) => row.inventoryItemId));
  const leftoverUnkeyed = unkeyed.filter(
    (row) => !keyedItems.has(row.inventoryItemId),
  );

  return [...keyedRows, ...leftoverUnkeyed];
}

export function extraAssignmentIdsToDelete<T extends AssignmentHistoryRow>(
  rows: T[],
  wantedDocIds: Set<string>,
): string[] {
  const keep = new Set(
    dedupeAssignmentHistory(rows)
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id)),
  );
  const extra: string[] = [];
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    if (wantedDocIds.has(id) || keep.has(id)) continue;
    extra.push(id);
  }
  return extra;
}
