import type { RiderMessengerCtx } from "./rider-messenger-reply";
import { replyRiderMessengerLinked } from "./rider-messenger-reply";
import {
  buildRiderMessengerJobNotFoundMessage,
  buildRiderMessengerReasonPrompt,
} from "./rider-messenger-copy";
import { buildRiderMessengerReasonListMessage } from "./rider-messenger-status-reasons-service";
import {
  formatGroupBulkReasonPrompt,
  resolveGroupFromSession,
  resolveGroupRiderTodoJobs,
} from "./rider-messenger-group-actions-service";
import {
  formatMultiBulkReasonPrompt,
  formatMultiTargetLabel,
  resolveJobTargets,
} from "./rider-messenger-multi-target-service";
import { resolveJobTarget } from "./rider-messenger-jobs-service";
import {
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import type { RiderMessengerJobRow } from "./rider-messenger-types";

export async function requireNearbyGroup(
  ctx: RiderMessengerCtx,
  params: { psid: string },
  groupNumber: string,
): Promise<Awaited<ReturnType<typeof resolveGroupFromSession>> | null> {
  const session = await getRiderMessengerSession(params.psid);
  const group = resolveGroupFromSession(session?.lastNearbyGroups, groupNumber);
  if (!group) {
    await replyRiderMessengerLinked({
      ...ctx,
      body: "I-send muna ang NEARBY → GROUP # para ma-load ang group.\nHal: NEARBY → GROUP 1 → DONE GROUP 1",
    });
    return null;
  }
  return group;
}

export async function handleFailOrCancelCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  jobs: RiderMessengerJobRow[];
  kind: "fail" | "cancel";
  target: string;
  targets?: string[];
  groupNumber?: string;
}): Promise<void> {
  const { ctx, psid, jobs, kind, target, targets, groupNumber } = params;
  const targetStatus = kind === "fail" ? "failed" : "cancelled";

  if (groupNumber) {
    const group = await requireNearbyGroup(ctx, { psid }, groupNumber);
    if (!group) return;
    const groupJobs = await resolveGroupRiderTodoJobs({
      businessId: ctx.businessId,
      riderId: ctx.riderId,
      group,
    });
    if (!groupJobs.length) {
      await replyRiderMessengerLinked({
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
      psid,
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
    await replyRiderMessengerLinked({
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

  if (targets?.length) {
    const targetLabel = formatMultiTargetLabel(targets);
    const { resolved, missing } = resolveJobTargets(jobs, targets);
    if (!resolved.length) {
      await replyRiderMessengerLinked({
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
      psid,
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
    await replyRiderMessengerLinked({
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

  const job = resolveJobTarget(jobs, target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  await saveRiderMessengerSession({
    psid,
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
  await replyRiderMessengerLinked({
    ...ctx,
    body: buildRiderMessengerReasonPrompt({
      targetStatus,
      referenceId: job.referenceId,
    }),
  });
}
