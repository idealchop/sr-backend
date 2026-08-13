import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import type { Transaction } from "./transaction-types";

export const MAX_ASSIGNED_RIDERS = 5;

export type AssignedRider = {
  riderId: string;
  riderName: string;
  isPrimary: boolean;
  joinedAt?: string;
  joinedByUserId?: string;
};

export type TransactionCashHandover = {
  handedOverByRiderId: string;
  handedOverByRiderName: string;
  amount: number;
  note?: string;
  recordedAt: string;
  recordedByUserId: string;
};

/**
 * When a business has exactly one non-inactive rider, use them as the default assignee
 * for delivery/collection dispatches (no manual rider picker needed).
 */
export async function getSoleActiveRiderId(
  businessId: string,
): Promise<string | undefined> {
  try {
    const riders = await RiderService.getRidersByBusiness(businessId);
    const active = riders.filter((r) => r.status !== "inactive" && r.id);
    if (active.length === 1 && active[0].id) {
      return active[0].id;
    }
  } catch (e) {
    logger.warn("getSoleActiveRiderId failed", e);
  }
  return undefined;
}

export async function isMultiRiderAssignEnabled(
  businessId: string,
): Promise<boolean> {
  try {
    const snap = await db.collection("businesses").doc(businessId).get();
    return snap.data()?.multiRiderAssignEnabled === true;
  } catch (e) {
    logger.warn("isMultiRiderAssignEnabled failed", e);
    return false;
  }
}

export function getAssignedRidersFromTransaction(
  tx: Pick<Transaction, "riderId" | "riderName" | "assignedRiders">,
): AssignedRider[] {
  const list = Array.isArray(tx.assignedRiders) ? tx.assignedRiders : [];
  const cleaned = list
    .map((entry) => {
      const riderId = String(entry?.riderId ?? "").trim();
      if (!riderId) return null;
      return {
        riderId,
        riderName: String(entry?.riderName ?? "").trim() || "Rider",
        isPrimary: entry?.isPrimary === true,
        ...(entry?.joinedAt ? { joinedAt: String(entry.joinedAt) } : {}),
        ...(entry?.joinedByUserId ?
          { joinedByUserId: String(entry.joinedByUserId) } :
          {}),
      } satisfies AssignedRider;
    })
    .filter((entry): entry is AssignedRider => Boolean(entry));

  if (cleaned.length > 0) {
    const primaryCount = cleaned.filter((r) => r.isPrimary).length;
    if (primaryCount === 1) return cleaned;
    return cleaned.map((r, index) => ({ ...r, isPrimary: index === 0 }));
  }

  const riderId = tx.riderId?.trim();
  if (!riderId) return [];
  return [
    {
      riderId,
      riderName: tx.riderName?.trim() || "Rider",
      isPrimary: true,
    },
  ];
}

async function resolveAssignedEntry(
  businessId: string,
  rawId: string,
  extras?: { joinedAt?: string; joinedByUserId?: string },
): Promise<AssignedRider | null> {
  const linked = await RiderService.resolveRiderDocumentId(businessId, rawId);
  if (!linked) return null;
  return {
    riderId: linked.riderId,
    riderName: linked.riderName,
    isPrimary: false,
    ...(extras?.joinedAt ? { joinedAt: extras.joinedAt } : {}),
    ...(extras?.joinedByUserId ?
      { joinedByUserId: extras.joinedByUserId } :
      {}),
  };
}

/**
 * Normalize riderId / riderName / assignedRiders on create/update payloads.
 * When multi-assign is off, only a single primary is kept.
 * @param {string} businessId Business id.
 * @param {Object} updates Mutable transaction patch.
 * @param {Object} [options] Optional multi flag + current assignees (update path).
 */
export async function syncTransactionRiderRef(
  businessId: string,
  updates: Partial<Transaction> & {
    riderId?: unknown;
    riderName?: unknown;
    assignedRiders?: unknown;
  },
  options?: {
    multiRiderAssignEnabled?: boolean;
    /** Existing assignees — preserves multi when patch only sends riderId. */
    currentAssignedRiders?: AssignedRider[] | null;
  },
): Promise<void> {
  const hasRiderId = Object.prototype.hasOwnProperty.call(updates, "riderId");
  const hasAssigned = Object.prototype.hasOwnProperty.call(
    updates,
    "assignedRiders",
  );
  if (!hasRiderId && !hasAssigned) return;

  const multiEnabled =
    options?.multiRiderAssignEnabled ??
    (await isMultiRiderAssignEnabled(businessId));

  if (hasAssigned) {
    const rawList = updates.assignedRiders;
    if (rawList === null || rawList === undefined) {
      updates.assignedRiders = FieldValue.delete() as unknown as undefined;
      if (hasRiderId) {
        const raw = updates.riderId;
        if (raw === null || raw === undefined || raw === "") {
          updates.riderId = FieldValue.delete() as unknown as undefined;
          updates.riderName = FieldValue.delete() as unknown as undefined;
        }
      } else {
        updates.riderId = FieldValue.delete() as unknown as undefined;
        updates.riderName = FieldValue.delete() as unknown as undefined;
      }
      return;
    }

    if (!Array.isArray(rawList)) {
      throw new Error("assignedRiders must be an array.");
    }

    const resolved: AssignedRider[] = [];
    for (const entry of rawList) {
      const rawId = String(
        (entry as { riderId?: string })?.riderId ?? "",
      ).trim();
      if (!rawId) continue;
      const linked = await resolveAssignedEntry(businessId, rawId, {
        joinedAt:
          typeof (entry as { joinedAt?: string })?.joinedAt === "string" ?
            (entry as { joinedAt: string }).joinedAt :
            undefined,
        joinedByUserId:
          typeof (entry as { joinedByUserId?: string })?.joinedByUserId ===
          "string" ?
            (entry as { joinedByUserId: string }).joinedByUserId :
            undefined,
      });
      if (!linked) {
        throw new Error(
          "Rider assignment must reference a profile in the riders collection.",
        );
      }
      if (resolved.some((r) => r.riderId === linked.riderId)) continue;
      resolved.push(linked);
      if (resolved.length >= MAX_ASSIGNED_RIDERS) break;
    }

    if (resolved.length === 0) {
      updates.riderId = FieldValue.delete() as unknown as undefined;
      updates.riderName = FieldValue.delete() as unknown as undefined;
      updates.assignedRiders = FieldValue.delete() as unknown as undefined;
      return;
    }

    if (!multiEnabled && resolved.length > 1) {
      throw new Error(
        "Multiple riders per order is disabled. Enable it in Catalog → Delivery & collection.",
      );
    }

    const preferredPrimary =
      typeof updates.riderId === "string" && updates.riderId.trim() ?
        updates.riderId.trim() :
        resolved.find((r) => (rawList as AssignedRider[]).some(
          (src) => src.riderId === r.riderId && src.isPrimary,
        ))?.riderId ??
        resolved[0].riderId;

    const primaryLinked = await RiderService.resolveRiderDocumentId(
      businessId,
      preferredPrimary,
    );
    const primaryId = primaryLinked?.riderId ?? resolved[0].riderId;

    const assignedRiders = resolved.map((r) => ({
      ...r,
      isPrimary: r.riderId === primaryId,
    }));
    const primary =
      assignedRiders.find((r) => r.isPrimary) ?? assignedRiders[0];

    updates.riderId = primary.riderId;
    updates.riderName = primary.riderName;
    updates.assignedRiders = assignedRiders;
    return;
  }

  // Singular riderId path
  const raw = updates.riderId;
  if (raw === null || raw === undefined || raw === "") {
    updates.riderId = FieldValue.delete() as unknown as undefined;
    updates.riderName = FieldValue.delete() as unknown as undefined;
    updates.assignedRiders = FieldValue.delete() as unknown as undefined;
    return;
  }

  const linked = await RiderService.resolveRiderDocumentId(
    businessId,
    String(raw),
  );
  if (!linked) {
    throw new Error(
      "Rider assignment must reference a profile in the riders collection.",
    );
  }

  // Multi-assign on + patch only sent riderId: keep the existing crew when the
  // primary stays on the job (avoids collapsing multi → one on unrelated edits).
  if (multiEnabled) {
    const currentList = Array.isArray(options?.currentAssignedRiders) ?
      options!.currentAssignedRiders! :
      [];
    if (currentList.length > 1) {
      const stillIncludes = currentList.some(
        (r) => r.riderId === linked.riderId,
      );
      if (stillIncludes) {
        const assignedRiders = currentList.map((r) => ({
          ...r,
          isPrimary: r.riderId === linked.riderId,
        }));
        const primary =
          assignedRiders.find((r) => r.isPrimary) ?? assignedRiders[0];
        updates.riderId = primary.riderId;
        updates.riderName = primary.riderName;
        updates.assignedRiders = assignedRiders;
        return;
      }
    }
  }

  updates.riderId = linked.riderId;
  updates.riderName = linked.riderName;
  updates.assignedRiders = [
    {
      riderId: linked.riderId,
      riderName: linked.riderName,
      isPrimary: true,
    },
  ];
}

export async function buildJoinAssignedRidersPatch(params: {
  businessId: string;
  current: Pick<Transaction, "riderId" | "riderName" | "assignedRiders">;
  joinRiderId: string;
  joinedByUserId: string;
}): Promise<{
  riderId: string;
  riderName: string;
  assignedRiders: AssignedRider[];
}> {
  const multiEnabled = await isMultiRiderAssignEnabled(params.businessId);
  if (!multiEnabled) {
    throw new Error(
      "Multiple riders per order is disabled. Enable it in Catalog → Delivery & collection.",
    );
  }

  const joinLinked = await RiderService.resolveRiderDocumentId(
    params.businessId,
    params.joinRiderId,
  );
  if (!joinLinked) {
    throw new Error(
      "Rider assignment must reference a profile in the riders collection.",
    );
  }

  const existing = getAssignedRidersFromTransaction(params.current);
  if (existing.some((r) => r.riderId === joinLinked.riderId)) {
    const primary = existing.find((r) => r.isPrimary) ?? existing[0];
    return {
      riderId: primary.riderId,
      riderName: primary.riderName,
      assignedRiders: existing,
    };
  }

  if (existing.length >= MAX_ASSIGNED_RIDERS) {
    throw new Error(`At most ${MAX_ASSIGNED_RIDERS} riders can be assigned.`);
  }

  const now = new Date().toISOString();
  const next: AssignedRider[] =
    existing.length === 0 ?
      [
        {
          riderId: joinLinked.riderId,
          riderName: joinLinked.riderName,
          isPrimary: true,
          joinedAt: now,
          joinedByUserId: params.joinedByUserId,
        },
      ] :
      [
        ...existing,
        {
          riderId: joinLinked.riderId,
          riderName: joinLinked.riderName,
          isPrimary: false,
          joinedAt: now,
          joinedByUserId: params.joinedByUserId,
        },
      ];

  const primary = next.find((r) => r.isPrimary) ?? next[0];
  return {
    riderId: primary.riderId,
    riderName: primary.riderName,
    assignedRiders: next,
  };
}

export async function buildLeaveAssignedRidersPatch(params: {
  businessId: string;
  current: Pick<Transaction, "riderId" | "riderName" | "assignedRiders">;
  leaveRiderId: string;
}): Promise<{
  riderId: string | null;
  riderName: string | null;
  assignedRiders: AssignedRider[] | null;
}> {
  const leaveLinked = await RiderService.resolveRiderDocumentId(
    params.businessId,
    params.leaveRiderId,
  );
  if (!leaveLinked) {
    throw new Error(
      "Rider assignment must reference a profile in the riders collection.",
    );
  }

  const existing = getAssignedRidersFromTransaction(params.current);
  const next = existing.filter((r) => r.riderId !== leaveLinked.riderId);
  if (next.length === existing.length) {
    const primary = existing.find((r) => r.isPrimary) ?? existing[0];
    if (!primary) {
      return { riderId: null, riderName: null, assignedRiders: null };
    }
    return {
      riderId: primary.riderId,
      riderName: primary.riderName,
      assignedRiders: existing,
    };
  }

  if (next.length === 0) {
    return { riderId: null, riderName: null, assignedRiders: null };
  }

  if (!next.some((r) => r.isPrimary)) {
    next[0] = { ...next[0], isPrimary: true };
  }
  const primary = next.find((r) => r.isPrimary) ?? next[0];
  return {
    riderId: primary.riderId,
    riderName: primary.riderName,
    assignedRiders: next,
  };
}
