import {
  buildRiderMessengerOtherReasonDetailPrompt,
  formatStatusReasonNotes,
  resolveRiderMessengerStatusReason,
} from "./rider-messenger-status-reasons-service";
import { formatGroupBulkCompleteSummary } from "./rider-messenger-group-actions-service";
import { formatMultiBulkCompleteSummary } from "./rider-messenger-multi-target-service";
import {
  clearRiderMessengerPending,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import { patchRiderMessengerTransaction } from "./rider-messenger-transaction-service";
import { parseRiderMessengerCommand } from "./rider-messenger-command-service";
import type { RiderMessengerSessionPending } from "./rider-messenger-types";
import {
  replyRiderMessengerLinked,
  type RiderMessengerCtx,
} from "./rider-messenger-reply";

type AwaitReasonPending = Extract<RiderMessengerSessionPending, { kind: "await_reason" }>;

type AwaitGroupReasonPending = Extract<
  RiderMessengerSessionPending,
  { kind: "await_group_reason" }
>;

type AwaitMultiReasonPending = Extract<
  RiderMessengerSessionPending,
  { kind: "await_multi_reason" }
>;

async function completeGroupWithReason(
  ctx: RiderMessengerCtx,
  pending: AwaitGroupReasonPending,
  reasonNotes: string,
): Promise<void> {
  for (const transactionId of pending.transactionIds) {
    await patchRiderMessengerTransaction({
      ...ctx,
      transactionId,
      updates: {
        deliveryStatus: pending.targetStatus,
        notes: `Status Reason: ${reasonNotes}`,
        totalAmount: 0,
        amountPaid: 0,
        balanceDue: 0,
        paymentStatus: "N/A",
        payments: [],
      },
      action: pending.targetStatus,
    });
  }
  await clearRiderMessengerPending(ctx.psid);
  await replyRiderMessengerLinked({
    ...ctx,
    body: formatGroupBulkCompleteSummary({
      groupNumber: pending.groupNumber,
      groupLabel: pending.groupLabel,
      referenceIds: pending.referenceIds,
      action: pending.targetStatus,
      reason: reasonNotes,
    }),
  });
}

async function completeMultiWithReason(
  ctx: RiderMessengerCtx,
  pending: AwaitMultiReasonPending,
  reasonNotes: string,
): Promise<void> {
  for (const transactionId of pending.transactionIds) {
    await patchRiderMessengerTransaction({
      ...ctx,
      transactionId,
      updates: {
        deliveryStatus: pending.targetStatus,
        notes: `Status Reason: ${reasonNotes}`,
        totalAmount: 0,
        amountPaid: 0,
        balanceDue: 0,
        paymentStatus: "N/A",
        payments: [],
      },
      action: pending.targetStatus,
    });
  }
  await clearRiderMessengerPending(ctx.psid);
  await replyRiderMessengerLinked({
    ...ctx,
    body: formatMultiBulkCompleteSummary({
      targetLabel: pending.targetLabel,
      referenceIds: pending.referenceIds,
      action: pending.targetStatus,
      reason: reasonNotes,
    }),
  });
}

async function completeStatusWithReason(
  ctx: RiderMessengerCtx,
  pending: AwaitReasonPending,
  reasonNotes: string,
): Promise<void> {
  await patchRiderMessengerTransaction({
    ...ctx,
    transactionId: pending.transactionId,
    updates: {
      deliveryStatus: pending.targetStatus,
      notes: `Status Reason: ${reasonNotes}`,
      totalAmount: 0,
      amountPaid: 0,
      balanceDue: 0,
      paymentStatus: "N/A",
      payments: [],
    },
    action: pending.targetStatus,
  });
  await clearRiderMessengerPending(ctx.psid);
  const statusLabel = pending.targetStatus === "failed" ? "failed" : "cancelled";
  await replyRiderMessengerLinked({
    ...ctx,
    body: [
      `Na-mark as ${statusLabel} · ${pending.referenceId}`,
      `Reason: ${reasonNotes}`,
      "",
      "I-send ang JOBS para i-refresh.",
    ].join("\n"),
  });
}

export async function handleAwaitReasonReply(
  ctx: RiderMessengerCtx,
  params: { psid: string; text: string },
  pending: AwaitReasonPending | AwaitGroupReasonPending | AwaitMultiReasonPending,
  command: ReturnType<typeof parseRiderMessengerCommand>,
): Promise<boolean> {
  if (pending.kind === "await_multi_reason") {
    if (pending.awaitingOtherDetail) {
      const detail = params.text.trim();
      if (!detail) {
        await replyRiderMessengerLinked({
          ...ctx,
          body: buildRiderMessengerOtherReasonDetailPrompt({
            referenceId: pending.targetLabel,
          }),
        });
        return true;
      }
      await completeMultiWithReason(
        ctx,
        pending,
        formatStatusReasonNotes(pending.reasonLabel ?? "Other", detail),
      );
      return true;
    }

    if (command.kind === "reason") {
      const reason = resolveRiderMessengerStatusReason(
        pending.targetStatus,
        command.index,
      );
      if (!reason) {
        await replyRiderMessengerLinked({
          ...ctx,
          body: `Walang REASON ${command.index}. I-send REASON # o free text.`,
        });
        return true;
      }
      if (reason.requiresNotes && !command.detail) {
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          pending: {
            ...pending,
            awaitingOtherDetail: true,
            reasonLabel: reason.label,
          },
        });
        await replyRiderMessengerLinked({
          ...ctx,
          body: buildRiderMessengerOtherReasonDetailPrompt({
            referenceId: pending.targetLabel,
          }),
        });
        return true;
      }
      await completeMultiWithReason(
        ctx,
        pending,
        formatStatusReasonNotes(reason.label, command.detail),
      );
      return true;
    }

    if (command.kind === "unknown" && params.text.trim()) {
      await completeMultiWithReason(ctx, pending, params.text.trim());
      return true;
    }

    return false;
  }

  if (pending.kind === "await_group_reason") {
    if (pending.awaitingOtherDetail) {
      const detail = params.text.trim();
      if (!detail) {
        await replyRiderMessengerLinked({
          ...ctx,
          body: buildRiderMessengerOtherReasonDetailPrompt({
            referenceId: `GROUP ${pending.groupNumber}`,
          }),
        });
        return true;
      }
      await completeGroupWithReason(
        ctx,
        pending,
        formatStatusReasonNotes(pending.reasonLabel ?? "Other", detail),
      );
      return true;
    }

    if (command.kind === "reason") {
      const reason = resolveRiderMessengerStatusReason(
        pending.targetStatus,
        command.index,
      );
      if (!reason) {
        await replyRiderMessengerLinked({
          ...ctx,
          body: `Walang REASON ${command.index}. I-send REASON # o free text.`,
        });
        return true;
      }
      if (reason.requiresNotes && !command.detail) {
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          pending: {
            ...pending,
            awaitingOtherDetail: true,
            reasonLabel: reason.label,
          },
        });
        await replyRiderMessengerLinked({
          ...ctx,
          body: buildRiderMessengerOtherReasonDetailPrompt({
            referenceId: `GROUP ${pending.groupNumber}`,
          }),
        });
        return true;
      }
      await completeGroupWithReason(
        ctx,
        pending,
        formatStatusReasonNotes(reason.label, command.detail),
      );
      return true;
    }

    if (command.kind === "unknown" && params.text.trim()) {
      await completeGroupWithReason(ctx, pending, params.text.trim());
      return true;
    }

    return false;
  }

  if (pending.awaitingOtherDetail) {
    const detail = params.text.trim();
    if (!detail) {
      await replyRiderMessengerLinked({
        ...ctx,
        body: buildRiderMessengerOtherReasonDetailPrompt({
          referenceId: pending.referenceId,
        }),
      });
      return true;
    }
    await completeStatusWithReason(
      ctx,
      pending,
      formatStatusReasonNotes(pending.reasonLabel ?? "Other", detail),
    );
    return true;
  }

  if (command.kind === "reason") {
    const reason = resolveRiderMessengerStatusReason(
      pending.targetStatus,
      command.index,
    );
    if (!reason) {
      await replyRiderMessengerLinked({
        ...ctx,
        body: `Walang REASON ${command.index}. I-send REASON # o free text.`,
      });
      return true;
    }
    if (reason.requiresNotes && !command.detail) {
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        pending: {
          kind: "await_reason",
          transactionId: pending.transactionId,
          targetStatus: pending.targetStatus,
          referenceId: pending.referenceId,
          awaitingOtherDetail: true,
          reasonLabel: reason.label,
        },
      });
      await replyRiderMessengerLinked({
        ...ctx,
        body: buildRiderMessengerOtherReasonDetailPrompt({
          referenceId: pending.referenceId,
        }),
      });
      return true;
    }
    await completeStatusWithReason(
      ctx,
      pending,
      formatStatusReasonNotes(reason.label, command.detail),
    );
    return true;
  }

  if (command.kind === "unknown" && params.text.trim()) {
    await completeStatusWithReason(ctx, pending, params.text.trim());
    return true;
  }

  return false;
}
