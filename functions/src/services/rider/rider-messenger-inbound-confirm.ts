import type { RiderMessengerCtx } from "./rider-messenger-reply";
import { replyRiderMessengerLinked } from "./rider-messenger-reply";
import { TransactionService } from "../transactions/transaction-service";
import {
  buildRiderMessengerCompletedMessage,
  buildRiderMessengerJobNotFoundMessage,
} from "./rider-messenger-copy";
import { formatGroupBulkCompleteSummary } from "./rider-messenger-group-actions-service";
import {
  formatMultiBulkCompleteSummary,
  splitCashAcrossJobs,
} from "./rider-messenger-multi-target-service";
import {
  clearRiderMessengerPending,
  getRiderMessengerSession,
} from "./rider-messenger-session-service";
import {
  buildRiderMessengerCompleteUpdates,
  patchRiderMessengerTransaction,
} from "./rider-messenger-transaction-service";
import {
  executeRiderMessengerOrder,
  formatOrderCreatedMessage,
} from "./rider-messenger-order-service";
import { ClaimNearbyDormantError } from "../transactions/claim-nearby-dormant-service";
import type { RiderMessengerSessionPending } from "./rider-messenger-types";
import type { RiderMessengerCommand } from "./rider-messenger-command-service";

type ConfirmGroupDonePending = Extract<
  RiderMessengerSessionPending,
  { kind: "confirm_group_done" }
>;

type ConfirmMultiDonePending = Extract<
  RiderMessengerSessionPending,
  { kind: "confirm_multi_done" }
>;

async function executeGroupDone(
  ctx: RiderMessengerCtx,
  pending: ConfirmGroupDonePending,
): Promise<void> {
  const cashParts = splitCashAcrossJobs(
    pending.cashAmount ?? 0,
    pending.transactionIds.length,
  );
  for (let i = 0; i < pending.transactionIds.length; i++) {
    const transactionId = pending.transactionIds[i];
    if (!transactionId) continue;
    const tx = await TransactionService.getTransaction(ctx.businessId, transactionId);
    if (!tx) continue;
    await patchRiderMessengerTransaction({
      ...ctx,
      transactionId,
      updates: buildRiderMessengerCompleteUpdates({
        transaction: tx,
        cashAmount: cashParts[i],
      }),
      action: "done_group",
    });
  }
  await clearRiderMessengerPending(ctx.psid);
  await replyRiderMessengerLinked({
    ...ctx,
    body: formatGroupBulkCompleteSummary({
      groupNumber: pending.groupNumber,
      groupLabel: pending.groupLabel,
      referenceIds: pending.referenceIds,
      action: "done",
    }),
  });
}

async function executeMultiDone(
  ctx: RiderMessengerCtx,
  pending: ConfirmMultiDonePending,
): Promise<void> {
  const cashParts = splitCashAcrossJobs(
    pending.cashAmount ?? 0,
    pending.transactionIds.length,
  );
  for (let i = 0; i < pending.transactionIds.length; i++) {
    const transactionId = pending.transactionIds[i];
    if (!transactionId) continue;
    const tx = await TransactionService.getTransaction(ctx.businessId, transactionId);
    if (!tx) continue;
    await patchRiderMessengerTransaction({
      ...ctx,
      transactionId,
      updates: buildRiderMessengerCompleteUpdates({
        transaction: tx,
        cashAmount: cashParts[i],
      }),
      action: "done_multi",
    });
  }
  await clearRiderMessengerPending(ctx.psid);
  await replyRiderMessengerLinked({
    ...ctx,
    body: formatMultiBulkCompleteSummary({
      targetLabel: pending.targetLabel,
      referenceIds: pending.referenceIds,
      action: "done",
    }),
  });
}

export async function tryHandleConfirmReply(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  command: RiderMessengerCommand;
  pending: RiderMessengerSessionPending | null | undefined;
}): Promise<boolean> {
  const { ctx, psid, command, pending } = params;

  if (command.kind === "confirm_yes" && pending?.kind === "confirm_order") {
    const session = await getRiderMessengerSession(psid);
    const lat = session?.lastRiderLat;
    const lng = session?.lastRiderLng;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      await replyRiderMessengerLinked({
        ...ctx,
        body: "Kailangan ng location pin para mag-ORDER. I-share ang location, tapos ulitin ang ORDER.",
      });
      return true;
    }
    try {
      const created = await executeRiderMessengerOrder({
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        psid: ctx.psid,
        customerId: pending.customerId,
        riderLat: lat,
        riderLng: lng,
        orderType: pending.orderType,
        orderSpec: pending.orderSpec,
      });
      await clearRiderMessengerPending(psid);
      await replyRiderMessengerLinked({
        ...ctx,
        body: formatOrderCreatedMessage({
          customerName: pending.customerName,
          referenceId: created.referenceId,
          type: created.type,
          summaryLines: pending.summaryLines,
          daysSinceLastOrder: pending.daysSinceLastOrder,
        }),
      });
    } catch (error) {
      const message =
        error instanceof ClaimNearbyDormantError ?
          error.message :
          "Hindi ma-create ang order. Try ulit.";
      await replyRiderMessengerLinked({ ...ctx, body: message });
    }
    return true;
  }

  if (command.kind === "confirm_yes" && pending?.kind === "confirm_group_done") {
    await executeGroupDone(ctx, pending);
    return true;
  }

  if (command.kind === "confirm_yes" && pending?.kind === "confirm_multi_done") {
    await executeMultiDone(ctx, pending);
    return true;
  }

  if (command.kind === "confirm_yes" && pending?.kind === "confirm_done") {
    const tx = await TransactionService.getTransaction(
      ctx.businessId,
      pending.transactionId,
    );
    if (!tx) {
      await clearRiderMessengerPending(psid);
      await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
      return true;
    }
    await patchRiderMessengerTransaction({
      ...ctx,
      transactionId: pending.transactionId,
      updates: buildRiderMessengerCompleteUpdates({
        transaction: tx,
        cashAmount: pending.cashAmount,
        deliveryProofUrl: pending.deliveryProofUrl,
      }),
      action: "done",
    });
    await clearRiderMessengerPending(psid);
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerCompletedMessage() });
    return true;
  }

  if (command.kind === "confirm_no") {
    const wasOrder = pending?.kind === "confirm_order";
    const wasGroup = pending?.kind === "confirm_group_done";
    const wasMulti = pending?.kind === "confirm_multi_done";
    await clearRiderMessengerPending(psid);
    await replyRiderMessengerLinked({
      ...ctx,
      body: wasOrder ?
        "Order cancelled. I-adjust ang lines: ORDER # DEL 3 slim alkaline, 2 round purified" :
        wasGroup ?
          "Group DONE cancelled. I-send JOBS o subukan ulit." :
          wasMulti ?
            "Bulk DONE cancelled. I-send JOBS o subukan ulit." :
            "Cancelled. I-send ang JOBS para makita ang list.",
    });
    return true;
  }

  return false;
}
