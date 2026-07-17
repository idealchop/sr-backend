import type { RiderMessengerCtx } from "./rider-messenger-reply";
import { replyRiderMessengerLinked } from "./rider-messenger-reply";
import {
  buildRiderMessengerInTransitMessage,
  buildRiderMessengerJobNotFoundMessage,
} from "./rider-messenger-copy";
import {
  formatGroupBulkDoneConfirmMessage,
  resolveGroupBulkDoneJobs,
  resolveGroupRiderTodoJobs,
} from "./rider-messenger-group-actions-service";
import {
  formatMultiBulkDoneConfirmMessage,
  formatMultiTargetLabel,
  resolveMultiBulkDoneJobs,
} from "./rider-messenger-multi-target-service";
import { resolveJobTarget } from "./rider-messenger-jobs-service";
import { resolveNearbyTarget } from "./rider-messenger-nearby-service";
import {
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import {
  claimRiderMessengerJob,
  patchRiderMessengerTransaction,
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
  createRiderMessengerOrder,
  formatOrderCreatedMessage,
} from "./rider-messenger-order-service";
import { requireSessionJobs, startDoneConfirm } from "./rider-messenger-intake-service";
import { requireNearbyGroup } from "./rider-messenger-inbound-status";
import type { RiderMessengerJobRow } from "./rider-messenger-types";
import type { CommunityOrderLine } from "../meta/community-dispatch-template-parser";

export async function handleStartCommand(params: {
  ctx: RiderMessengerCtx;
  jobs: RiderMessengerJobRow[];
  target: string;
}): Promise<void> {
  const { ctx, jobs, target } = params;
  const job = resolveJobTarget(jobs, target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  await patchRiderMessengerTransaction({
    ...ctx,
    transactionId: job.transactionId,
    updates: { deliveryStatus: "in-transit" },
    action: "start",
  });
  await replyRiderMessengerLinked({
    ...ctx,
    body: buildRiderMessengerInTransitMessage({
      customerName: job.customerName,
      referenceId: job.referenceId,
      phone: job.phone,
    }),
  });
}

export async function handleDoneCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  jobs: RiderMessengerJobRow[];
  target: string;
  targets?: string[];
  groupNumber?: string;
  cashAmount?: number;
}): Promise<void> {
  const { ctx, psid, jobs, target, targets, groupNumber, cashAmount } = params;

  if (groupNumber) {
    const group = await requireNearbyGroup(ctx, { psid }, groupNumber);
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
      await replyRiderMessengerLinked({
        ...ctx,
        body: blockedCollections.length ?
          `Walang pwede i-DONE sa GROUP ${group.groupNumber} — REPORT # muna sa collection:\n${blockedCollections.map((j) => `• ${j.referenceId}`).join("\n")}` :
          `Walang assigned jobs mo sa GROUP ${group.groupNumber} na pwede i-DONE.`,
      });
      return;
    }
    await saveRiderMessengerSession({
      psid,
      businessId: ctx.businessId,
      riderId: ctx.riderId,
      lastJobs: jobs,
      pending: {
        kind: "confirm_group_done",
        transactionIds: eligible.map((row) => row.job.transactionId),
        referenceIds: eligible.map((row) => row.job.referenceId),
        groupNumber: group.groupNumber,
        groupLabel: group.label,
        ...(cashAmount != null ? { cashAmount } : {}),
      },
    });
    await replyRiderMessengerLinked({
      ...ctx,
      body: formatGroupBulkDoneConfirmMessage({
        group,
        jobs: eligible,
        blockedCollections,
        cashAmount,
      }),
    });
    return;
  }

  if (targets?.length) {
    const targetLabel = formatMultiTargetLabel(targets);
    const { eligible, blockedCollections, missing } = await resolveMultiBulkDoneJobs({
      businessId: ctx.businessId,
      jobs,
      tokens: targets,
    });
    if (!eligible.length) {
      await replyRiderMessengerLinked({
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
      psid,
      businessId: ctx.businessId,
      riderId: ctx.riderId,
      lastJobs: jobs,
      pending: {
        kind: "confirm_multi_done",
        transactionIds: eligible.map((row) => row.job.transactionId),
        referenceIds: eligible.map((row) => row.job.referenceId),
        targetLabel,
        ...(cashAmount != null ? { cashAmount } : {}),
      },
    });
    await replyRiderMessengerLinked({
      ...ctx,
      body: formatMultiBulkDoneConfirmMessage({
        targetLabel,
        jobs: eligible,
        blockedCollections,
        missing,
        cashAmount,
      }),
    });
    return;
  }

  const job = resolveJobTarget(jobs, target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  await startDoneConfirm(ctx, { job, cashAmount });
}

export async function handleDetailsCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  target: string;
}): Promise<void> {
  const { ctx, psid, target } = params;
  const session = await getRiderMessengerSession(psid);
  if (session?.activeList === "nearby") {
    await replyRiderMessengerLinked({
      ...ctx,
      body: "I-send GROUP # muna (hal. GROUP 1), tapos DETAILS # para sa order o suki.",
    });
    return;
  }
  const jobs = await requireSessionJobs(ctx);
  const listTarget = resolveActiveListTarget({
    session,
    jobs,
    token: target,
  });
  if (!listTarget) {
    const hint =
      session?.activeList === "group_detail" ?
        "Walang # na yan sa GROUP list. I-send GROUP # ulit o NEARBY para i-refresh." :
        session?.activeList === "jobs" ?
          "Walang # na yan sa JOBS list. I-send JOBS para i-refresh." :
          buildRiderMessengerJobNotFoundMessage();
    await replyRiderMessengerLinked({ ...ctx, body: hint });
    return;
  }
  const message =
    listTarget.list === "jobs" ?
      await buildDetailsMessageForJob({
        businessId: ctx.businessId,
        job: listTarget.job,
      }) :
      await buildDetailsMessageForNearby({
        businessId: ctx.businessId,
        nearby: listTarget.nearby,
      });
  if (!message) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  await replyRiderMessengerLinked({ ...ctx, body: message });
}

export async function handleOrderCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  target: string;
  orderType?: "delivery" | "collection";
  orderQty?: number;
  orderLines?: CommunityOrderLine[];
  orderRaw?: string;
}): Promise<void> {
  const { ctx, psid, target, orderType, orderQty, orderLines, orderRaw } = params;
  const session = await getRiderMessengerSession(psid);
  if (session?.activeList !== "group_detail" || !session.lastNearby?.length) {
    await replyRiderMessengerLinked({
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
    await replyRiderMessengerLinked({
      ...ctx,
      body: "Kailangan ng location pin para mag-ORDER. I-share ang location, tapos NEARBY → GROUP # ulit.",
    });
    return;
  }
  const nearbyRow = resolveNearbyTarget(session.lastNearby, target);
  if (!nearbyRow) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  try {
    const result = await createRiderMessengerOrder({
      businessId: ctx.businessId,
      riderId: ctx.riderId,
      psid: ctx.psid,
      nearby: nearbyRow,
      order: {
        target,
        type: orderType,
        qty: orderQty,
        orderLines,
        orderRaw,
      },
      riderLat: lat,
      riderLng: lng,
    });
    if (result.kind === "preview") {
      await saveRiderMessengerSession({
        psid,
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
      await replyRiderMessengerLinked({ ...ctx, body: result.message });
      return;
    }
    await replyRiderMessengerLinked({
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
    await replyRiderMessengerLinked({ ...ctx, body: message });
  }
}

export async function handleClaimCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  jobs: RiderMessengerJobRow[];
  target: string;
}): Promise<void> {
  const { ctx, psid, jobs, target } = params;
  const session = await getRiderMessengerSession(psid);
  if (session?.activeList === "group_detail" && session.lastNearby?.length) {
    const lat = session.lastRiderLat;
    const lng = session.lastRiderLng;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      await replyRiderMessengerLinked({
        ...ctx,
        body: "Kailangan ng fresh location pin para i-claim ang stop. I-share ang location, tapos NEARBY → GROUP # ulit.",
      });
      return;
    }
    const nearbyRow = resolveNearbyTarget(session.lastNearby, target);
    if (!nearbyRow) {
      await replyRiderMessengerLinked({
        ...ctx,
        body: buildRiderMessengerJobNotFoundMessage(),
      });
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
        await replyRiderMessengerLinked({
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
        await replyRiderMessengerLinked({
          ...ctx,
          body: `Na-add sa route mo ang ${nearbyRow.referenceId} · ${nearbyRow.customerName}. I-send ang JOBS para i-refresh.`,
        });
      } else {
        await replyRiderMessengerLinked({ ...ctx, body: "Hindi ma-claim ang stop. Try ulit." });
      }
    } catch (error) {
      const message =
        error instanceof ClaimNearbyStopError ||
        error instanceof ClaimNearbyDormantError ?
          error.message :
          "Hindi ma-claim ang stop. Try ulit.";
      await replyRiderMessengerLinked({ ...ctx, body: message });
    }
    return;
  }

  const job = resolveJobTarget(jobs, target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  await claimRiderMessengerJob({
    ...ctx,
    transactionId: job.transactionId,
  });
  await replyRiderMessengerLinked({ ...ctx, body: `Na-claim ang ${job.referenceId}. I-send ang JOBS para i-refresh.` });
}
