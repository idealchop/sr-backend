import { logger } from "../observability/logging/logger";
import {
  sendMetaRiderMessengerQuickReplies,
  sendRiderMessengerPrefixedText,
} from "../meta/meta-rider-messenger-send-service";
import { TransactionService } from "../transactions/transaction-service";
import { RiderMessengerLinkService } from "./rider-messenger-link-service";
import {
  parseRiderMessengerCommand,
  parseRiderMessengerPostback,
} from "./rider-messenger-command-service";
import {
  buildRiderMessengerCompletedMessage,
  buildRiderMessengerConfirmDoneMessage,
  buildRiderMessengerHelpText,
  buildRiderMessengerInTransitMessage,
  buildRiderMessengerJobNotFoundMessage,
  buildRiderMessengerLinkSuccessMessage,
  buildRiderMessengerReasonPrompt,
  buildRiderMessengerReportSavedMessage,
  buildRiderMessengerReportStartMessage,
  RIDER_MESSENGER_UNLINKED_HELP,
} from "./rider-messenger-copy";
import {
  buildRiderMessengerOtherReasonDetailPrompt,
  buildRiderMessengerReasonListMessage,
  formatStatusReasonNotes,
  resolveRiderMessengerStatusReason,
} from "./rider-messenger-status-reasons-service";
import {
  formatGroupBulkCompleteSummary,
  formatGroupBulkDoneConfirmMessage,
  formatGroupBulkReasonPrompt,
  resolveGroupBulkDoneJobs,
  resolveGroupFromSession,
  resolveGroupRiderTodoJobs,
} from "./rider-messenger-group-actions-service";
import {
  formatMultiBulkCompleteSummary,
  formatMultiBulkDoneConfirmMessage,
  formatMultiBulkReasonPrompt,
  formatMultiTargetLabel,
  resolveJobTargets,
  resolveMultiBulkDoneJobs,
  splitCashAcrossJobs,
} from "./rider-messenger-multi-target-service";
import {
  formatJobsListMessage,
  loadRiderMessengerJobs,
  resolveJobTarget,
} from "./rider-messenger-jobs-service";
import {
  formatGroupDetailMessage,
  formatNearbyIndexMessage,
  groupDetailRows,
  loadRiderMessengerNearbyGroups,
  resolveNearbyGroup,
  resolveNearbyTarget,
} from "./rider-messenger-nearby-service";
import {
  downloadMessengerImageAttachment,
  uploadRiderMessengerDeliveryProof,
} from "./rider-messenger-proof-service";
import {
  clearRiderMessengerPending,
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import {
  applyReportBreakdownToCollectionItem,
  findNextUnreportedCollectionIndex,
  formatReportItemAck,
  formatReportNeedContainerMessage,
  parseReportBreakdownReply,
  resolveReportTargetIndex,
} from "./rider-messenger-report-service";
import {
  buildRiderMessengerCompleteUpdates,
  claimRiderMessengerJob,
  patchRiderMessengerTransaction,
  RiderMessengerTransactionError,
} from "./rider-messenger-transaction-service";
import {
  ClaimNearbyStopError,
  claimNearbyStopForLinkedRider,
} from "../transactions/claim-nearby-stop-service";
import {
  ClaimNearbyDormantError,
  claimNearbyDormantForLinkedRider,
} from "../transactions/claim-nearby-dormant-service";
import {
  buildDetailsMessageForJob,
  buildDetailsMessageForNearby,
} from "./rider-messenger-details-service";
import { resolveActiveListTarget } from "./rider-messenger-list-target";
import {
  bridgeRiderTextToTeamChat,
  notifyOwnerRiderOpenedChat,
  setRiderMessengerChatMode,
} from "../team/team-messenger-bridge-service";
import {
  createRiderMessengerOrder,
  executeRiderMessengerOrder,
  formatOrderCreatedMessage,
} from "./rider-messenger-order-service";
import {
  RIDER_MESSENGER_POSTBACK_CONFIRM_NO,
  RIDER_MESSENGER_POSTBACK_CONFIRM_YES,
  RIDER_MESSENGER_POSTBACK_HELP,
  RIDER_MESSENGER_POSTBACK_JOBS,
  RIDER_MESSENGER_POSTBACK_NEARBY,
  type RiderMessengerSessionPending,
} from "./rider-messenger-types";

type RiderCtx = {
  psid: string;
  businessId: string;
  riderId: string;
  riderName: string;
  stationLabel: string;
  metaMessageId?: string;
};

async function replyLinked(params: {
  psid: string;
  stationLabel: string;
  riderName: string;
  body: string;
  quickReplies?: Array<{ title: string; payload: string }>;
}): Promise<void> {
  if (params.quickReplies?.length) {
    await sendMetaRiderMessengerQuickReplies({
      recipientPsid: params.psid,
      text: `📍 ${params.stationLabel} · ${params.riderName}\n${params.body}`.slice(0, 2000),
      quickReplies: params.quickReplies,
    });
    return;
  }
  await sendRiderMessengerPrefixedText({
    recipientPsid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: params.body,
  });
}

async function handleJobs(params: RiderCtx & { filter: "all" | "delivery" | "collection" }): Promise<void> {
  const jobs = await loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: params.filter,
  });
  const session = await getRiderMessengerSession(params.psid);
  await saveRiderMessengerSession({
    psid: params.psid,
    businessId: params.businessId,
    riderId: params.riderId,
    lastJobs: jobs,
    activeList: "jobs",
    lastRiderLat: session?.lastRiderLat,
    lastRiderLng: session?.lastRiderLng,
    pending: null,
  });
  await replyLinked({
    psid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: formatJobsListMessage(jobs),
    quickReplies: [
      { title: "JOBS", payload: RIDER_MESSENGER_POSTBACK_JOBS },
      { title: "NEARBY", payload: RIDER_MESSENGER_POSTBACK_NEARBY },
      { title: "HELP", payload: RIDER_MESSENGER_POSTBACK_HELP },
    ],
  });
}

function requireRiderLocation(
  session: Awaited<ReturnType<typeof getRiderMessengerSession>>,
): { lat: number; lng: number } | null {
  const lat = session?.lastRiderLat;
  const lng = session?.lastRiderLng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return { lat, lng };
}

const LOCATION_REQUIRED_HINT =
  "I-share muna ang location pin mo dito sa chat.\n\nPag na-receive na ang pin, automatic na lalabas ang NEARBY group list.";

async function handleNearbyIndex(
  params: RiderCtx & { riderLat: number; riderLng: number },
): Promise<void> {
  const groups = await loadRiderMessengerNearbyGroups({
    businessId: params.businessId,
    riderId: params.riderId,
    riderLat: params.riderLat,
    riderLng: params.riderLng,
  });
  const session = await getRiderMessengerSession(params.psid);
  await saveRiderMessengerSession({
    psid: params.psid,
    businessId: params.businessId,
    riderId: params.riderId,
    lastNearbyGroups: groups,
    activeList: "nearby",
    lastRiderLat: params.riderLat,
    lastRiderLng: params.riderLng,
    lastJobs: session?.lastJobs,
    pending: null,
  });
  await replyLinked({
    psid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: formatNearbyIndexMessage(groups),
    quickReplies: [
      { title: "JOBS", payload: RIDER_MESSENGER_POSTBACK_JOBS },
      { title: "NEARBY", payload: RIDER_MESSENGER_POSTBACK_NEARBY },
      { title: "HELP", payload: RIDER_MESSENGER_POSTBACK_HELP },
    ],
  });
}

async function handleGroupDetail(
  params: RiderCtx & { groupNumber: string },
): Promise<void> {
  const session = await getRiderMessengerSession(params.psid);
  const groups = session?.lastNearbyGroups;
  if (!groups?.length) {
    await replyLinked({
      ...params,
      body: "I-send muna ang NEARBY (o share location) para makita ang group numbers.",
    });
    return;
  }

  const group = resolveNearbyGroup(groups, params.groupNumber);
  if (!group) {
    await replyLinked({
      ...params,
      body: `Walang GROUP ${params.groupNumber}. I-send ang NEARBY para i-refresh ang list.`,
    });
    return;
  }

  const detailRows = groupDetailRows(group);
  await saveRiderMessengerSession({
    psid: params.psid,
    businessId: params.businessId,
    riderId: params.riderId,
    lastNearbyGroups: groups,
    lastNearby: detailRows,
    activeList: "group_detail",
    activeGroupNumber: group.groupNumber,
    lastRiderLat: session?.lastRiderLat,
    lastRiderLng: session?.lastRiderLng,
    lastJobs: session?.lastJobs,
    pending: null,
  });
  await replyLinked({
    psid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: formatGroupDetailMessage(group),
    quickReplies: [
      { title: "NEARBY", payload: RIDER_MESSENGER_POSTBACK_NEARBY },
      { title: "JOBS", payload: RIDER_MESSENGER_POSTBACK_JOBS },
      { title: "HELP", payload: RIDER_MESSENGER_POSTBACK_HELP },
    ],
  });
}

async function requireSessionJobs(params: {
  psid: string;
  businessId: string;
  riderId: string;
}): Promise<Awaited<ReturnType<typeof loadRiderMessengerJobs>>> {
  const session = await getRiderMessengerSession(params.psid);
  if (session?.lastJobs?.length) return session.lastJobs;
  return loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: "all",
  });
}

async function promptReportItem(
  ctx: RiderCtx,
  pending: Extract<RiderMessengerSessionPending, { kind: "report_collect" }>,
): Promise<void> {
  const item = pending.items[pending.nextIndex];
  if (!item) return;
  const allNames = pending.items.map((row) => row.name);
  const singleContainer =
    pending.items.length === 1 ||
    new Set(
      pending.items.map((row) => {
        const name = row.name.toLowerCase();
        for (const token of ["round", "slim", "square", "pet"]) {
          if (name.includes(token)) return token;
        }
        return name;
      }),
    ).size === 1;
  await replyLinked({
    ...ctx,
    body: buildRiderMessengerReportStartMessage({
      itemName: item.name,
      index: pending.nextIndex + 1,
      total: pending.items.length,
      qtyExpected: item.qtyExpected,
      singleContainer,
      allItemNames: pending.items.length > 1 ? allNames : undefined,
    }),
  });
}

async function handleReportQtyReply(ctx: RiderCtx, qtyText: string): Promise<boolean> {
  const session = await getRiderMessengerSession(ctx.psid);
  if (session?.pending?.kind !== "report_collect") return false;

  const pending = session.pending;
  const items = [...pending.items];
  const target = resolveReportTargetIndex(
    qtyText,
    items,
    pending.nextIndex,
  );
  if ("error" in target) {
    await replyLinked({
      ...ctx,
      body: formatReportNeedContainerMessage(target.options),
    });
    return true;
  }

  const current = items[target.index];
  if (!current) return false;

  const breakdown = parseReportBreakdownReply(qtyText, {
    qtyExpected: current.qtyExpected,
    collectionItems: items,
    currentItemIndex: target.index,
  });
  if (!breakdown) {
    await replyLinked({
      ...ctx,
      body: "Hindi maintindihan. Hal: 5 · round kulang ng lima · slim may 1 sira",
    });
    return true;
  }

  const updated = applyReportBreakdownToCollectionItem(current, breakdown);
  items[target.index] = updated;

  const nextIndex = findNextUnreportedCollectionIndex(items);
  if (nextIndex >= 0) {
    await saveRiderMessengerSession({
      psid: ctx.psid,
      businessId: ctx.businessId,
      riderId: ctx.riderId,
      lastJobs: session.lastJobs,
      pending: {
        kind: "report_collect",
        transactionId: pending.transactionId,
        items,
        nextIndex,
      },
    });
    await replyLinked({
      ...ctx,
      body: `${updated.name}: ${formatReportItemAck(updated)}`,
    });
    await promptReportItem(ctx, {
      kind: "report_collect",
      transactionId: pending.transactionId,
      items,
      nextIndex,
    });
    return true;
  }

  await patchRiderMessengerTransaction({
    ...ctx,
    transactionId: pending.transactionId,
    updates: { collectionItems: items },
    action: "report",
  });
  await clearRiderMessengerPending(ctx.psid);
  await replyLinked({
    ...ctx,
    body: [
      `${updated.name}: ${formatReportItemAck(updated)}`,
      buildRiderMessengerReportSavedMessage(),
    ].join("\n"),
  });
  return true;
}

type AwaitReasonPending = Extract<RiderMessengerSessionPending, { kind: "await_reason" }>;

type AwaitGroupReasonPending = Extract<
  RiderMessengerSessionPending,
  { kind: "await_group_reason" }
>;

type ConfirmGroupDonePending = Extract<
  RiderMessengerSessionPending,
  { kind: "confirm_group_done" }
>;

type ConfirmMultiDonePending = Extract<
  RiderMessengerSessionPending,
  { kind: "confirm_multi_done" }
>;

type AwaitMultiReasonPending = Extract<
  RiderMessengerSessionPending,
  { kind: "await_multi_reason" }
>;

async function requireNearbyGroup(
  ctx: RiderCtx,
  params: { psid: string },
  groupNumber: string,
): Promise<Awaited<ReturnType<typeof resolveGroupFromSession>> | null> {
  const session = await getRiderMessengerSession(params.psid);
  const group = resolveGroupFromSession(session?.lastNearbyGroups, groupNumber);
  if (!group) {
    await replyLinked({
      ...ctx,
      body: "I-send muna ang NEARBY → GROUP # para ma-load ang group.\nHal: NEARBY → GROUP 1 → DONE GROUP 1",
    });
    return null;
  }
  return group;
}

async function completeGroupWithReason(
  ctx: RiderCtx,
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
  await replyLinked({
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

async function executeGroupDone(
  ctx: RiderCtx,
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
  await replyLinked({
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
  ctx: RiderCtx,
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
  await replyLinked({
    ...ctx,
    body: formatMultiBulkCompleteSummary({
      targetLabel: pending.targetLabel,
      referenceIds: pending.referenceIds,
      action: "done",
    }),
  });
}

async function completeMultiWithReason(
  ctx: RiderCtx,
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
  await replyLinked({
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
  ctx: RiderCtx,
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
  await replyLinked({
    ...ctx,
    body: [
      `Na-mark as ${statusLabel} · ${pending.referenceId}`,
      `Reason: ${reasonNotes}`,
      "",
      "I-send ang JOBS para i-refresh.",
    ].join("\n"),
  });
}

async function handleAwaitReasonReply(
  ctx: RiderCtx,
  params: { psid: string; text: string },
  pending: AwaitReasonPending | AwaitGroupReasonPending | AwaitMultiReasonPending,
  command: Awaited<ReturnType<typeof parseRiderMessengerCommand>>,
): Promise<boolean> {
  if (pending.kind === "await_multi_reason") {
    if (pending.awaitingOtherDetail) {
      const detail = params.text.trim();
      if (!detail) {
        await replyLinked({
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
        await replyLinked({
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
        await replyLinked({
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
        await replyLinked({
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
        await replyLinked({
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
        await replyLinked({
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
      await replyLinked({
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
      await replyLinked({
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
      await replyLinked({
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

async function startDoneConfirm(ctx: RiderCtx, params: {
  job: Awaited<ReturnType<typeof resolveJobTarget>>;
  cashAmount?: number;
  deliveryProofUrl?: string;
}): Promise<void> {
  if (!params.job) return;
  const jobs = await requireSessionJobs(ctx);
  await saveRiderMessengerSession({
    psid: ctx.psid,
    businessId: ctx.businessId,
    riderId: ctx.riderId,
    lastJobs: jobs,
    pending: {
      kind: "confirm_done",
      transactionId: params.job.transactionId,
      ...(params.cashAmount != null ? { cashAmount: params.cashAmount } : {}),
      ...(params.deliveryProofUrl ? { deliveryProofUrl: params.deliveryProofUrl } : {}),
    },
  });
  await replyLinked({
    ...ctx,
    body: buildRiderMessengerConfirmDoneMessage({
      customerName: params.job.customerName,
      referenceId: params.job.referenceId,
      cashAmount: params.cashAmount,
    }),
    quickReplies: [
      { title: "YES", payload: RIDER_MESSENGER_POSTBACK_CONFIRM_YES },
      { title: "NO", payload: RIDER_MESSENGER_POSTBACK_CONFIRM_NO },
    ],
  });
}

export async function handleRiderMessengerInboundLocation(params: {
  psid: string;
  latitude: number;
  longitude: number;
  metaMessageId?: string;
}): Promise<void> {
  const linked = await RiderMessengerLinkService.resolveLinkedRider(params.psid);
  if (!linked) {
    await sendRiderMessengerPrefixedText({
      recipientPsid: params.psid,
      stationLabel: "SmartRefill Rider",
      riderName: "Setup",
      body: RIDER_MESSENGER_UNLINKED_HELP,
    });
    return;
  }

  const ctx: RiderCtx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  await handleNearbyIndex({
    ...ctx,
    riderLat: params.latitude,
    riderLng: params.longitude,
  });
}

export async function handleRiderMessengerInboundImage(params: {
  psid: string;
  imageUrl: string;
  caption?: string;
  metaMessageId?: string;
}): Promise<void> {
  const linked = await RiderMessengerLinkService.resolveLinkedRider(params.psid);
  if (!linked) {
    await sendRiderMessengerPrefixedText({
      recipientPsid: params.psid,
      stationLabel: "SmartRefill Rider",
      riderName: "Setup",
      body: RIDER_MESSENGER_UNLINKED_HELP,
    });
    return;
  }

  const ctx: RiderCtx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  const command = parseRiderMessengerCommand(params.caption ?? "");
  if (command.kind !== "done") {
    await replyLinked({
      ...ctx,
      body: "Para sa proof photo, lagyan ng caption: DONE # (hal. DONE 2).",
    });
    return;
  }

  const jobs = await requireSessionJobs(ctx);
  const job = resolveJobTarget(jobs, command.target);
  if (!job) {
    await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }

  const downloaded = await downloadMessengerImageAttachment(params.imageUrl);
  if (!downloaded) {
    await replyLinked({ ...ctx, body: "Hindi ma-download ang photo. Try ulit." });
    return;
  }

  const proofUrl = await uploadRiderMessengerDeliveryProof({
    businessId: ctx.businessId,
    referenceId: job.referenceId,
    imageBuffer: downloaded.buffer,
    contentType: downloaded.contentType,
  });

  await startDoneConfirm(ctx, {
    job,
    cashAmount: command.cashAmount,
    deliveryProofUrl: proofUrl ?? undefined,
  });
}

export async function handleRiderMessengerInboundText(params: {
  psid: string;
  text: string;
  metaMessageId?: string;
}): Promise<void> {
  const command = parseRiderMessengerCommand(params.text);
  const linked = await RiderMessengerLinkService.resolveLinkedRider(params.psid);

  if (command.kind === "link") {
    try {
      const result = await RiderMessengerLinkService.bindPsidWithCode({
        psid: params.psid,
        codeRaw: command.code,
      });
      await replyLinked({
        psid: params.psid,
        stationLabel: result.stationLabel,
        riderName: result.riderName,
        body: buildRiderMessengerLinkSuccessMessage(),
        quickReplies: [
          { title: "JOBS", payload: RIDER_MESSENGER_POSTBACK_JOBS },
          { title: "HELP", payload: RIDER_MESSENGER_POSTBACK_HELP },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Link failed.";
      await sendRiderMessengerPrefixedText({
        recipientPsid: params.psid,
        stationLabel: "SmartRefill Rider",
        riderName: "Link",
        body: message,
      });
    }
    return;
  }

  if (!linked) {
    await sendRiderMessengerPrefixedText({
      recipientPsid: params.psid,
      stationLabel: "SmartRefill Rider",
      riderName: "Setup",
      body: RIDER_MESSENGER_UNLINKED_HELP,
    });
    return;
  }

  const ctx: RiderCtx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  try {
    if (command.kind === "help") {
      await replyLinked({ ...ctx, body: buildRiderMessengerHelpText() });
      return;
    }

    if (command.kind === "jobs") {
      await handleJobs({ ...ctx, filter: command.filter });
      return;
    }

    if (command.kind === "nearby") {
      const session = await getRiderMessengerSession(params.psid);
      const loc = requireRiderLocation(session);
      if (!loc) {
        await replyLinked({ ...ctx, body: LOCATION_REQUIRED_HINT });
        return;
      }
      await handleNearbyIndex({ ...ctx, riderLat: loc.lat, riderLng: loc.lng });
      return;
    }

    if (command.kind === "group") {
      await handleGroupDetail({ ...ctx, groupNumber: command.target });
      return;
    }

    if (command.kind === "unknown" && command.raw.toUpperCase() === "GROUP") {
      await replyLinked({
        ...ctx,
        body: "I-send GROUP # para makita ang customers (hal. GROUP 1).\nI-send muna ang NEARBY para makita ang group numbers.",
      });
      return;
    }

    if (command.kind === "stats") {
      const jobs = await loadRiderMessengerJobs({
        businessId: ctx.businessId,
        riderId: ctx.riderId,
      });
      const done = jobs.filter((j) => j.isDoneToday).length;
      const todo = jobs.filter((j) => j.isTodo).length;
      await replyLinked({
        ...ctx,
        body: `Ngayong araw: ${done} tapos · ${todo} natitira`,
      });
      return;
    }

    const session = await getRiderMessengerSession(params.psid);

    if (command.kind === "chat_open") {
      await clearRiderMessengerPending(params.psid);
      await setRiderMessengerChatMode({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        riderName: ctx.riderName,
        chatMode: true,
      });
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        chatMode: true,
        pending: null,
      });
      await notifyOwnerRiderOpenedChat({
        businessId: ctx.businessId,
        riderName: ctx.riderName,
      });
      await replyLinked({
        ...ctx,
        body: [
          "💬 Team chat open.",
          "Mag-message nang libre — makikita ng owner sa Team Chat at Messenger.",
          "CLOSE CHAT pag tapos na.",
          "Pwede pa rin ang JOBS, DONE, at iba pang commands.",
        ].join("\n"),
      });
      return;
    }

    if (command.kind === "chat_close") {
      await setRiderMessengerChatMode({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        riderName: ctx.riderName,
        chatMode: false,
      });
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        chatMode: false,
      });
      await replyLinked({
        ...ctx,
        body: "Team chat closed. I-send CHAT ulit kapag kailangan kausapin ang owner.",
      });
      return;
    }

    if (session?.pending?.kind === "report_collect" && command.kind === "unknown") {
      if (await handleReportQtyReply(ctx, params.text)) return;
    }

    if (session?.pending?.kind === "await_reason" || session?.pending?.kind === "await_group_reason" || session?.pending?.kind === "await_multi_reason") {
      if (await handleAwaitReasonReply(ctx, params, session.pending, command)) {
        return;
      }
    }

    if (command.kind === "reason") {
      await replyLinked({
        ...ctx,
        body: "Gamitin ang REASON # pagkatapos ng FAIL # o CANCEL #.\nHal: FAIL 2 → REASON 1",
      });
      return;
    }

    if (command.kind === "confirm_yes" && session?.pending?.kind === "confirm_order") {
      const lat = session.lastRiderLat;
      const lng = session.lastRiderLng;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        await replyLinked({
          ...ctx,
          body: "Kailangan ng location pin para mag-ORDER. I-share ang location, tapos ulitin ang ORDER.",
        });
        return;
      }
      try {
        const pending = session.pending;
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
        await clearRiderMessengerPending(params.psid);
        await replyLinked({
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
        await replyLinked({ ...ctx, body: message });
      }
      return;
    }

    if (command.kind === "confirm_yes" && session?.pending?.kind === "confirm_group_done") {
      await executeGroupDone(ctx, session.pending);
      return;
    }

    if (command.kind === "confirm_yes" && session?.pending?.kind === "confirm_multi_done") {
      await executeMultiDone(ctx, session.pending);
      return;
    }

    if (command.kind === "confirm_yes" && session?.pending?.kind === "confirm_done") {
      const tx = await TransactionService.getTransaction(
        ctx.businessId,
        session.pending.transactionId,
      );
      if (!tx) {
        await clearRiderMessengerPending(params.psid);
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await patchRiderMessengerTransaction({
        ...ctx,
        transactionId: session.pending.transactionId,
        updates: buildRiderMessengerCompleteUpdates({
          transaction: tx,
          cashAmount: session.pending.cashAmount,
          deliveryProofUrl: session.pending.deliveryProofUrl,
        }),
        action: "done",
      });
      await clearRiderMessengerPending(params.psid);
      await replyLinked({ ...ctx, body: buildRiderMessengerCompletedMessage() });
      return;
    }

    if (command.kind === "confirm_no") {
      const wasOrder = session?.pending?.kind === "confirm_order";
      const wasGroup = session?.pending?.kind === "confirm_group_done";
      const wasMulti = session?.pending?.kind === "confirm_multi_done";
      await clearRiderMessengerPending(params.psid);
      await replyLinked({
        ...ctx,
        body: wasOrder ?
          "Order cancelled. I-adjust ang lines: ORDER # DEL 3 slim alkaline, 2 round purified" :
          wasGroup ?
            "Group DONE cancelled. I-send JOBS o subukan ulit." :
            wasMulti ?
              "Bulk DONE cancelled. I-send JOBS o subukan ulit." :
              "Cancelled. I-send ang JOBS para makita ang list.",
      });
      return;
    }

    const jobs = await requireSessionJobs(ctx);

    if (command.kind === "start") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await patchRiderMessengerTransaction({
        ...ctx,
        transactionId: job.transactionId,
        updates: { deliveryStatus: "in-transit" },
        action: "start",
      });
      await replyLinked({
        ...ctx,
        body: buildRiderMessengerInTransitMessage({
          customerName: job.customerName,
          referenceId: job.referenceId,
          phone: job.phone,
        }),
      });
      return;
    }

    if (command.kind === "done") {
      if (command.groupNumber) {
        const group = await requireNearbyGroup(ctx, params, command.groupNumber);
        if (!group) return;
        const eligible = await resolveGroupBulkDoneJobs({
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          group,
        });
        const todos = await resolveGroupRiderTodoJobs({
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          group,
        });
        const blockedCollections = todos.filter((job) => {
          const hit = eligible.find((row) => row.job.transactionId === job.transactionId);
          return !hit && job.type === "collection";
        });
        if (!eligible.length) {
          await replyLinked({
            ...ctx,
            body: blockedCollections.length ?
              `Walang pwede i-DONE sa GROUP ${group.groupNumber} — REPORT # muna sa collection:\n${blockedCollections.map((j) => `• ${j.referenceId}`).join("\n")}` :
              `Walang assigned jobs mo sa GROUP ${group.groupNumber} na pwede i-DONE.`,
          });
          return;
        }
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          lastJobs: jobs,
          pending: {
            kind: "confirm_group_done",
            transactionIds: eligible.map((row) => row.job.transactionId),
            referenceIds: eligible.map((row) => row.job.referenceId),
            groupNumber: group.groupNumber,
            groupLabel: group.label,
            ...(command.cashAmount != null ? { cashAmount: command.cashAmount } : {}),
          },
        });
        await replyLinked({
          ...ctx,
          body: formatGroupBulkDoneConfirmMessage({
            group,
            jobs: eligible,
            blockedCollections,
            cashAmount: command.cashAmount,
          }),
        });
        return;
      }

      if (command.targets?.length) {
        const targetLabel = formatMultiTargetLabel(command.targets);
        const { eligible, blockedCollections, missing } = await resolveMultiBulkDoneJobs({
          businessId: ctx.businessId,
          jobs,
          tokens: command.targets,
        });
        if (!eligible.length) {
          await replyLinked({
            ...ctx,
            body: blockedCollections.length ?
              `Walang pwede i-DONE sa ${targetLabel} — REPORT # muna sa collection:\n${blockedCollections.map((j) => `• ${j.referenceId}`).join("\n")}` :
              missing.length ?
                `Hindi mahanap ang jobs sa ${targetLabel}. I-send muna ang JOBS.` :
                `Walang pwede i-DONE sa ${targetLabel}.`,
          });
          return;
        }
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          lastJobs: jobs,
          pending: {
            kind: "confirm_multi_done",
            transactionIds: eligible.map((row) => row.job.transactionId),
            referenceIds: eligible.map((row) => row.job.referenceId),
            targetLabel,
            ...(command.cashAmount != null ? { cashAmount: command.cashAmount } : {}),
          },
        });
        await replyLinked({
          ...ctx,
          body: formatMultiBulkDoneConfirmMessage({
            targetLabel,
            jobs: eligible,
            blockedCollections,
            missing,
            cashAmount: command.cashAmount,
          }),
        });
        return;
      }

      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await startDoneConfirm(ctx, { job, cashAmount: command.cashAmount });
      return;
    }

    if (command.kind === "fail" || command.kind === "cancel") {
      const targetStatus = command.kind === "fail" ? "failed" : "cancelled";

      if (command.groupNumber) {
        const group = await requireNearbyGroup(ctx, params, command.groupNumber);
        if (!group) return;
        const groupJobs = await resolveGroupRiderTodoJobs({
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          group,
        });
        if (!groupJobs.length) {
          await replyLinked({
            ...ctx,
            body: `Walang assigned jobs mo sa GROUP ${group.groupNumber} na pwede i-${targetStatus}.`,
          });
          return;
        }
        const reasonList = buildRiderMessengerReasonListMessage({
          targetStatus,
          referenceId: `GROUP ${group.groupNumber}`,
        });
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          lastJobs: jobs,
          pending: {
            kind: "await_group_reason",
            transactionIds: groupJobs.map((job) => job.transactionId),
            referenceIds: groupJobs.map((job) => job.referenceId),
            groupNumber: group.groupNumber,
            groupLabel: group.label,
            targetStatus,
          },
        });
        await replyLinked({
          ...ctx,
          body: formatGroupBulkReasonPrompt({
            group,
            jobs: groupJobs,
            targetStatus,
            reasonListMessage: reasonList,
          }),
        });
        return;
      }

      if (command.targets?.length) {
        const targetLabel = formatMultiTargetLabel(command.targets);
        const { resolved, missing } = resolveJobTargets(jobs, command.targets);
        if (!resolved.length) {
          await replyLinked({
            ...ctx,
            body: `Hindi mahanap ang jobs sa ${targetLabel}. I-send muna ang JOBS.`,
          });
          return;
        }
        const reasonList = buildRiderMessengerReasonListMessage({
          targetStatus,
          referenceId: targetLabel,
        });
        await saveRiderMessengerSession({
          psid: params.psid,
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          lastJobs: jobs,
          pending: {
            kind: "await_multi_reason",
            transactionIds: resolved.map((job) => job.transactionId),
            referenceIds: resolved.map((job) => job.referenceId),
            targetLabel,
            targetStatus,
          },
        });
        await replyLinked({
          ...ctx,
          body: formatMultiBulkReasonPrompt({
            targetLabel,
            jobs: resolved,
            targetStatus,
            reasonListMessage: reasonList,
            missing,
          }),
        });
        return;
      }

      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        lastJobs: jobs,
        pending: {
          kind: "await_reason",
          transactionId: job.transactionId,
          targetStatus,
          referenceId: job.referenceId,
        },
      });
      await replyLinked({
        ...ctx,
        body: buildRiderMessengerReasonPrompt({
          targetStatus,
          referenceId: job.referenceId,
        }),
      });
      return;
    }

    if (command.kind === "details") {
      const session = await getRiderMessengerSession(params.psid);
      if (session?.activeList === "nearby") {
        await replyLinked({
          ...ctx,
          body: "I-send GROUP # muna (hal. GROUP 1), tapos DETAILS # para sa order o suki.",
        });
        return;
      }
      const jobs = await requireSessionJobs(ctx);
      const target = resolveActiveListTarget({
        session,
        jobs,
        token: command.target,
      });
      if (!target) {
        const hint =
          session?.activeList === "group_detail" ?
            "Walang # na yan sa GROUP list. I-send GROUP # ulit o NEARBY para i-refresh." :
            session?.activeList === "jobs" ?
              "Walang # na yan sa JOBS list. I-send JOBS para i-refresh." :
              buildRiderMessengerJobNotFoundMessage();
        await replyLinked({ ...ctx, body: hint });
        return;
      }
      const message =
        target.list === "jobs" ?
          await buildDetailsMessageForJob({
            businessId: ctx.businessId,
            job: target.job,
          }) :
          await buildDetailsMessageForNearby({
            businessId: ctx.businessId,
            nearby: target.nearby,
          });
      if (!message) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await replyLinked({ ...ctx, body: message });
      return;
    }

    if (command.kind === "order") {
      const session = await getRiderMessengerSession(params.psid);
      if (session?.activeList !== "group_detail" || !session.lastNearby?.length) {
        await replyLinked({
          ...ctx,
          body: "ORDER # ay para sa quiet suki sa GROUP list.\nI-send NEARBY → GROUP # muna.\nHal: ORDER 2 DELIVERY 5",
        });
        return;
      }
      const lat = session.lastRiderLat;
      const lng = session.lastRiderLng;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        await replyLinked({
          ...ctx,
          body: "Kailangan ng location pin para mag-ORDER. I-share ang location, tapos NEARBY → GROUP # ulit.",
        });
        return;
      }
      const nearbyRow = resolveNearbyTarget(session.lastNearby, command.target);
      if (!nearbyRow) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      try {
        const result = await createRiderMessengerOrder({
          businessId: ctx.businessId,
          riderId: ctx.riderId,
          psid: ctx.psid,
          nearby: nearbyRow,
          order: {
            target: command.target,
            type: command.orderType,
            qty: command.orderQty,
            orderLines: command.orderLines,
            orderRaw: command.orderRaw,
          },
          riderLat: lat,
          riderLng: lng,
        });
        if (result.kind === "preview") {
          await saveRiderMessengerSession({
            psid: params.psid,
            businessId: ctx.businessId,
            riderId: ctx.riderId,
            lastNearby: session.lastNearby,
            lastNearbyGroups: session.lastNearbyGroups,
            activeList: session.activeList,
            activeGroupNumber: session.activeGroupNumber,
            lastRiderLat: lat,
            lastRiderLng: lng,
            lastJobs: session.lastJobs,
            pending: result.pending,
          });
          await replyLinked({ ...ctx, body: result.message });
          return;
        }
        await replyLinked({
          ...ctx,
          body: formatOrderCreatedMessage({
            customerName: nearbyRow.customerName,
            referenceId: result.referenceId,
            type: result.type,
            summaryLines: result.summaryLines,
            daysSinceLastOrder: nearbyRow.daysSinceLastOrder,
          }),
        });
      } catch (error) {
        const message =
          error instanceof ClaimNearbyDormantError ?
            error.message :
            "Hindi ma-create ang order. Try ulit.";
        await replyLinked({ ...ctx, body: message });
      }
      return;
    }

    if (command.kind === "claim") {
      const session = await getRiderMessengerSession(params.psid);
      if (session?.activeList === "group_detail" && session.lastNearby?.length) {
        const lat = session.lastRiderLat;
        const lng = session.lastRiderLng;
        if (
          typeof lat !== "number" ||
          typeof lng !== "number" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          await replyLinked({
            ...ctx,
            body: "Kailangan ng fresh location pin para i-claim ang stop. I-share ang location, tapos NEARBY → GROUP # ulit.",
          });
          return;
        }
        const nearbyRow = resolveNearbyTarget(session.lastNearby, command.target);
        if (!nearbyRow) {
          await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
          return;
        }
        try {
          if (nearbyRow.source === "dormant") {
            const created = await claimNearbyDormantForLinkedRider({
              businessId: ctx.businessId,
              customerId: nearbyRow.customerId,
              riderId: ctx.riderId,
              riderLat: lat,
              riderLng: lng,
              actorId: `rider_messenger:${ctx.psid}`,
            });
            await replyLinked({
              ...ctx,
              body: `Na-schedule ang ${nearbyRow.customerName} (${created.referenceId}) — quiet ${nearbyRow.daysSinceLastOrder ?? 7}d. I-send ang JOBS para i-refresh.`,
            });
          } else if (nearbyRow.transactionId) {
            await claimNearbyStopForLinkedRider({
              businessId: ctx.businessId,
              transactionId: nearbyRow.transactionId,
              riderId: ctx.riderId,
              riderLat: lat,
              riderLng: lng,
              actorId: `rider_messenger:${ctx.psid}`,
            });
            await replyLinked({
              ...ctx,
              body: `Na-add sa route mo ang ${nearbyRow.referenceId} · ${nearbyRow.customerName}. I-send ang JOBS para i-refresh.`,
            });
          } else {
            await replyLinked({ ...ctx, body: "Hindi ma-claim ang stop. Try ulit." });
          }
        } catch (error) {
          const message =
            error instanceof ClaimNearbyStopError ||
            error instanceof ClaimNearbyDormantError ?
              error.message :
              "Hindi ma-claim ang stop. Try ulit.";
          await replyLinked({ ...ctx, body: message });
        }
        return;
      }

      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      await claimRiderMessengerJob({
        ...ctx,
        transactionId: job.transactionId,
      });
      await replyLinked({ ...ctx, body: `Na-claim ang ${job.referenceId}. I-send ang JOBS para i-refresh.` });
      return;
    }

    if (command.kind === "report") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
        return;
      }
      const tx = await TransactionService.getTransaction(ctx.businessId, job.transactionId);
      if (!tx || tx.type !== "collection") {
        await replyLinked({ ...ctx, body: "REPORT ay para sa collection jobs lang." });
        return;
      }
      const items = tx.collectionItems ?? [];
      if (!items.length) {
        await replyLinked({ ...ctx, body: "Walang collection items sa job na ito." });
        return;
      }
      const pending = {
        kind: "report_collect" as const,
        transactionId: job.transactionId,
        items,
        nextIndex: 0,
      };
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        lastJobs: jobs,
        pending,
      });
      await promptReportItem(ctx, pending);
      return;
    }

    if (session?.chatMode && command.kind === "unknown" && params.text.trim()) {
      await bridgeRiderTextToTeamChat({
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        riderName: ctx.riderName,
        text: params.text,
      });
      return;
    }

    await replyLinked({
      ...ctx,
      body: `Hindi ko maintindihan ang "${params.text.slice(0, 80)}".\n\n${buildRiderMessengerHelpText()}`,
    });
  } catch (error) {
    const message =
      error instanceof RiderMessengerTransactionError ?
        error.message :
        "May error. Try ulit o i-send ang HELP.";
    logger.warn("handleRiderMessengerInboundText failed", { error, psid: params.psid });
    await replyLinked({ ...ctx, body: message });
  }
}

export async function handleRiderMessengerPostback(params: {
  psid: string;
  payload: string;
  metaMessageId?: string;
}): Promise<boolean> {
  const command = parseRiderMessengerPostback(params.payload);
  if (!command) return false;

  if (command.kind === "confirm_yes") {
    await handleRiderMessengerInboundText({
      psid: params.psid,
      text: "YES",
      metaMessageId: params.metaMessageId,
    });
    return true;
  }
  if (command.kind === "confirm_no") {
    await handleRiderMessengerInboundText({
      psid: params.psid,
      text: "NO",
      metaMessageId: params.metaMessageId,
    });
    return true;
  }
  if (command.kind === "jobs") {
    await handleRiderMessengerInboundText({
      psid: params.psid,
      text: "JOBS",
      metaMessageId: params.metaMessageId,
    });
    return true;
  }
  if (command.kind === "help") {
    await handleRiderMessengerInboundText({
      psid: params.psid,
      text: "HELP",
      metaMessageId: params.metaMessageId,
    });
    return true;
  }
  if (command.kind === "nearby") {
    await handleRiderMessengerInboundText({
      psid: params.psid,
      text: "NEARBY",
      metaMessageId: params.metaMessageId,
    });
    return true;
  }

  return false;
}
