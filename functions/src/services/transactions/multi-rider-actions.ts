import { logAuditEvent } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import { TransactionService } from "./transaction-service";
import type { Transaction } from "./transaction-types";
import {
  buildJoinAssignedRidersPatch,
  buildLeaveAssignedRidersPatch,
  getAssignedRidersFromTransaction,
  isMultiRiderAssignEnabled,
  type TransactionCashHandover,
} from "./transaction-rider-helpers";

export class MultiRiderActionError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "MultiRiderActionError";
    this.statusCode = statusCode;
  }
}

async function resolveActorRiderId(
  businessId: string,
  actorUid: string,
  businessRole: string,
  preferredRiderId?: string,
): Promise<{ riderId: string; riderName: string } | null> {
  if (preferredRiderId?.trim()) {
    const linked = await RiderService.resolveRiderDocumentId(
      businessId,
      preferredRiderId.trim(),
    );
    if (linked) return linked;
  }
  if (businessRole === "owner" || businessRole === "admin") {
    return null;
  }
  const byUser = await RiderService.getRiderByUserId(businessId, actorUid);
  if (!byUser?.id) return null;
  return { riderId: byUser.id, riderName: byUser.name || "Rider" };
}

export async function joinTransactionAsRider(params: {
  businessId: string;
  transactionId: string;
  actorUid: string;
  actorName?: string;
  businessRole: string;
  /** Owner/admin may join a specific roster rider; riders join themselves. */
  riderId?: string;
}): Promise<Transaction> {
  const multiEnabled = await isMultiRiderAssignEnabled(params.businessId);
  if (!multiEnabled) {
    throw new MultiRiderActionError(
      400,
      "Multiple riders per order is disabled. Enable it in Catalog → Delivery & collection.",
    );
  }

  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!tx) {
    throw new MultiRiderActionError(404, "Transaction not found");
  }

  const actorRider = await resolveActorRiderId(
    params.businessId,
    params.actorUid,
    params.businessRole,
    params.riderId,
  );

  let joinRiderId: string;
  if (params.businessRole === "owner" || params.businessRole === "admin") {
    const fromBody = params.riderId?.trim();
    if (fromBody) {
      joinRiderId = fromBody;
    } else if (actorRider) {
      joinRiderId = actorRider.riderId;
    } else {
      throw new MultiRiderActionError(
        400,
        "riderId is required when owner/admin adds a rider",
      );
    }
  } else {
    if (!actorRider) {
      throw new MultiRiderActionError(
        403,
        "No rider profile linked to your account",
      );
    }
    joinRiderId = actorRider.riderId;
  }

  const patch = await buildJoinAssignedRidersPatch({
    businessId: params.businessId,
    current: tx,
    joinRiderId,
    joinedByUserId: params.actorUid,
  });

  await TransactionService.updateTransaction(
    params.businessId,
    params.transactionId,
    patch,
    params.actorUid,
    params.actorName,
  );

  await logAuditEvent(
    "TRANSACTION_RIDER_JOIN",
    {
      businessId: params.businessId,
      userId: params.actorUid,
      userName: params.actorName,
      riderId: joinRiderId,
    },
    null,
    patch,
    params.transactionId,
  );

  const updated = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!updated) {
    throw new MultiRiderActionError(500, "Failed to reload transaction");
  }
  return updated;
}

export async function leaveTransactionAsRider(params: {
  businessId: string;
  transactionId: string;
  actorUid: string;
  actorName?: string;
  businessRole: string;
  riderId?: string;
}): Promise<Transaction> {
  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!tx) {
    throw new MultiRiderActionError(404, "Transaction not found");
  }

  const actorRider = await resolveActorRiderId(
    params.businessId,
    params.actorUid,
    params.businessRole,
    params.riderId,
  );

  let leaveRiderId: string;
  if (params.businessRole === "owner" || params.businessRole === "admin") {
    leaveRiderId = params.riderId?.trim() || actorRider?.riderId || "";
    if (!leaveRiderId) {
      throw new MultiRiderActionError(400, "riderId is required");
    }
  } else {
    if (!actorRider) {
      throw new MultiRiderActionError(
        403,
        "No rider profile linked to your account",
      );
    }
    leaveRiderId = actorRider.riderId;
  }

  const patch = await buildLeaveAssignedRidersPatch({
    businessId: params.businessId,
    current: tx,
    leaveRiderId,
  });

  await TransactionService.updateTransaction(
    params.businessId,
    params.transactionId,
    {
      riderId: patch.riderId,
      riderName: patch.riderName,
      assignedRiders: patch.assignedRiders,
    } as Partial<Transaction>,
    params.actorUid,
    params.actorName,
  );

  await logAuditEvent(
    "TRANSACTION_RIDER_LEAVE",
    {
      businessId: params.businessId,
      userId: params.actorUid,
      userName: params.actorName,
      riderId: leaveRiderId,
    },
    null,
    patch,
    params.transactionId,
  );

  const updated = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!updated) {
    throw new MultiRiderActionError(500, "Failed to reload transaction");
  }
  return updated;
}

export async function recordTransactionCashHandover(params: {
  businessId: string;
  transactionId: string;
  actorUid: string;
  actorName?: string;
  businessRole: string;
  handedOverByRiderId: string;
  amount: number;
  note?: string;
}): Promise<Transaction> {
  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!tx) {
    throw new MultiRiderActionError(404, "Transaction not found");
  }

  const assigned = getAssignedRidersFromTransaction(tx);
  if (assigned.length < 2) {
    throw new MultiRiderActionError(
      400,
      "Cash handover notes apply to multi-rider cash jobs only",
    );
  }

  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new MultiRiderActionError(400, "Invalid handover amount");
  }

  const linked = await RiderService.resolveRiderDocumentId(
    params.businessId,
    params.handedOverByRiderId,
  );
  if (!linked) {
    throw new MultiRiderActionError(400, "Invalid handedOverByRiderId");
  }
  if (!assigned.some((r) => r.riderId === linked.riderId)) {
    throw new MultiRiderActionError(
      400,
      "Handover rider must be assigned to this order",
    );
  }

  const isOwnerAdmin =
    params.businessRole === "owner" || params.businessRole === "admin";
  if (!isOwnerAdmin) {
    const actorRider = await RiderService.getRiderByUserId(
      params.businessId,
      params.actorUid,
    );
    if (!actorRider?.id || !assigned.some((r) => r.riderId === actorRider.id)) {
      throw new MultiRiderActionError(
        403,
        "Only assigned riders or owner/admin can record cash handover",
      );
    }
  }

  const cashHandover: TransactionCashHandover = {
    handedOverByRiderId: linked.riderId,
    handedOverByRiderName: linked.riderName,
    amount,
    recordedAt: new Date().toISOString(),
    recordedByUserId: params.actorUid,
    ...(params.note?.trim() ? { note: params.note.trim().slice(0, 500) } : {}),
  };

  await TransactionService.updateTransaction(
    params.businessId,
    params.transactionId,
    { cashHandover } as Partial<Transaction>,
    params.actorUid,
    params.actorName,
  );

  await logAuditEvent(
    "TRANSACTION_CASH_HANDOVER",
    {
      businessId: params.businessId,
      userId: params.actorUid,
      userName: params.actorName,
      riderId: linked.riderId,
      amount,
    },
    null,
    cashHandover,
    params.transactionId,
  );

  const updated = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!updated) {
    throw new MultiRiderActionError(500, "Failed to reload transaction");
  }
  return updated;
}
