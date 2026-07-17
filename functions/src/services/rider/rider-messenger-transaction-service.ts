import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { derivePaymentFields } from "../transactions/payment-status";
import {
  mapDeliveryStatusToEvent,
  maybeSendCustomerTxnNotification,
} from "../portal/customer-transaction-notifier";

export class RiderMessengerTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiderMessengerTransactionError";
  }
}

async function logRiderMessengerEvent(params: {
  businessId: string;
  psid: string;
  riderId: string;
  transactionId?: string;
  action: string;
  metaMessageId?: string;
}): Promise<void> {
  const id = params.metaMessageId?.trim() || `${Date.now()}_${params.action}`;
  await db
    .collection("businesses")
    .doc(params.businessId)
    .collection("rider_messenger_events")
    .doc(id)
    .set({
      psid: params.psid,
      riderId: params.riderId,
      transactionId: params.transactionId ?? null,
      action: params.action,
      sourceChannel: "rider_messenger",
      createdAt: FieldValue.serverTimestamp(),
    });
}

function assertRiderCanAccessTransaction(
  tx: Transaction,
  riderId: string,
  allowUnassignedClaim: boolean,
): void {
  if (!tx.id) throw new RiderMessengerTransactionError("Transaction not found.");
  if (tx.riderId?.trim() && tx.riderId !== riderId) {
    throw new RiderMessengerTransactionError("This job is assigned to another rider.");
  }
  if (!tx.riderId?.trim() && !allowUnassignedClaim) {
    throw new RiderMessengerTransactionError("This job is not assigned to you yet. Ask owner to assign or enable CLAIM.");
  }
}

async function notifyCustomerIfNeeded(params: {
  businessId: string;
  transactionId: string;
  before: Transaction;
  after: Transaction;
}): Promise<void> {
  const event = mapDeliveryStatusToEvent(
    params.before.deliveryStatus,
    params.after.deliveryStatus,
  );
  if (!event) return;
  void maybeSendCustomerTxnNotification({
    businessId: params.businessId,
    transaction: { ...params.after, id: params.transactionId },
    beforeStatus: params.before.deliveryStatus,
    event,
  }).catch((err) => {
    logger.warn("rider_messenger_customer_notify_failed", {
      businessId: params.businessId,
      transactionId: params.transactionId,
      err,
    });
  });
}

export function buildRiderMessengerCompleteUpdates(params: {
  transaction: Transaction;
  cashAmount?: number;
  deliveryProofUrl?: string;
}): Partial<Transaction> {
  const updates: Partial<Transaction> = { deliveryStatus: "completed" };

  if (params.deliveryProofUrl?.trim()) {
    updates.deliveryProofUrl = params.deliveryProofUrl.trim();
  }

  const cashAmount = params.cashAmount;
  if (cashAmount != null && cashAmount > 0) {
    const payment = {
      id: `rm_${Date.now()}`,
      amount: cashAmount,
      date: new Date().toISOString(),
      method: "cash" as const,
      confirmedByRider: true,
      notes: "Cash via Messenger",
    };
    const amountPaid = Math.max(0, (params.transaction.amountPaid || 0) + cashAmount);
    const totalAmount = Math.max(0, params.transaction.totalAmount || 0);
    const derived = derivePaymentFields(totalAmount, amountPaid);
    updates.amountPaid = derived.amountPaid;
    updates.balanceDue = derived.balanceDue;
    updates.paymentStatus = derived.paymentStatus;
    updates.payments = [...(params.transaction.payments || []), payment];
  }

  return updates;
}

export async function patchRiderMessengerTransaction(params: {
  businessId: string;
  riderId: string;
  psid: string;
  transactionId: string;
  updates: Partial<Transaction>;
  metaMessageId?: string;
  action: string;
  allowUnassignedClaim?: boolean;
}): Promise<void> {
  const before = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!before) {
    throw new RiderMessengerTransactionError("Job not found.");
  }

  assertRiderCanAccessTransaction(
    before,
    params.riderId,
    Boolean(params.allowUnassignedClaim),
  );

  const actorId = `rider_messenger:${params.psid}`;
  const applied = await TransactionService.updateTransaction(
    params.businessId,
    params.transactionId,
    params.updates,
    actorId,
    before.riderName?.trim() || undefined,
  );

  if (!applied) return;

  const after = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (after) {
    await notifyCustomerIfNeeded({
      businessId: params.businessId,
      transactionId: params.transactionId,
      before,
      after,
    });
  }

  await logRiderMessengerEvent({
    businessId: params.businessId,
    psid: params.psid,
    riderId: params.riderId,
    transactionId: params.transactionId,
    action: params.action,
    metaMessageId: params.metaMessageId,
  });
}

export async function claimRiderMessengerJob(params: {
  businessId: string;
  riderId: string;
  psid: string;
  transactionId: string;
  metaMessageId?: string;
}): Promise<void> {
  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.transactionId,
  );
  if (!tx) throw new RiderMessengerTransactionError("Job not found.");
  if (tx.riderId?.trim()) {
    throw new RiderMessengerTransactionError("Job already assigned.");
  }

  await patchRiderMessengerTransaction({
    ...params,
    updates: { riderId: params.riderId },
    action: "claim",
    allowUnassignedClaim: true,
  });
}
