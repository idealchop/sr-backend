import { logger } from "../observability/logging/logger";
import { sendRiderMessengerPrefixedText } from "../meta/meta-rider-messenger-send-service";
import {
  replyRiderMessengerLinked,
  type RiderMessengerCtx,
} from "./rider-messenger-reply";
import { handleAwaitReasonReply } from "./rider-messenger-reason-flow";
import { RiderMessengerLinkService } from "./rider-messenger-link-service";
import { parseRiderMessengerCommand } from "./rider-messenger-command-service";
import {
  buildRiderMessengerHelpText,
  buildRiderMessengerLinkSuccessMessage,
  RIDER_MESSENGER_UNLINKED_HELP,
} from "./rider-messenger-copy";
import {
  formatGroupDetailMessage,
  resolveNearbyGroup,
  groupDetailRows,
} from "./rider-messenger-nearby-service";
import {
  clearRiderMessengerPending,
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import { RiderMessengerTransactionError } from "./rider-messenger-transaction-service";
import { formatJobsListMessage, loadRiderMessengerJobs } from "./rider-messenger-jobs-service";
import {
  bridgeRiderTextToTeamChat,
  notifyOwnerRiderOpenedChat,
  setRiderMessengerChatMode,
} from "../team/team-messenger-bridge-service";
import {
  RIDER_MESSENGER_POSTBACK_HELP,
  RIDER_MESSENGER_POSTBACK_JOBS,
  RIDER_MESSENGER_POSTBACK_NEARBY,
} from "./rider-messenger-types";
import {
  handleNearbyIndex,
  requireSessionJobs,
} from "./rider-messenger-intake-service";
import {
  handleReportCommand,
  handleReportQtyReply,
} from "./rider-messenger-inbound-report";
import { handleFailOrCancelCommand } from "./rider-messenger-inbound-status";
import { tryHandleConfirmReply } from "./rider-messenger-inbound-confirm";
import {
  handleClaimCommand,
  handleDetailsCommand,
  handleDoneCommand,
  handleOrderCommand,
  handleStartCommand,
} from "./rider-messenger-inbound-actions";

async function handleJobs(params: RiderMessengerCtx & { filter: "all" | "delivery" | "collection" }): Promise<void> {
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
  await replyRiderMessengerLinked({
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

async function handleGroupDetail(
  params: RiderMessengerCtx & { groupNumber: string },
): Promise<void> {
  const session = await getRiderMessengerSession(params.psid);
  const groups = session?.lastNearbyGroups;
  if (!groups?.length) {
    await replyRiderMessengerLinked({
      ...params,
      body: "I-send muna ang NEARBY (o share location) para makita ang group numbers.",
    });
    return;
  }

  const group = resolveNearbyGroup(groups, params.groupNumber);
  if (!group) {
    await replyRiderMessengerLinked({
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
  await replyRiderMessengerLinked({
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
      await replyRiderMessengerLinked({
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

  const ctx: RiderMessengerCtx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  try {
    if (command.kind === "help") {
      await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerHelpText() });
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
        await replyRiderMessengerLinked({ ...ctx, body: LOCATION_REQUIRED_HINT });
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
      await replyRiderMessengerLinked({
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
      await replyRiderMessengerLinked({
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
      await replyRiderMessengerLinked({
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
      await replyRiderMessengerLinked({
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
      await replyRiderMessengerLinked({
        ...ctx,
        body: "Gamitin ang REASON # pagkatapos ng FAIL # o CANCEL #.\nHal: FAIL 2 → REASON 1",
      });
      return;
    }

    if (await tryHandleConfirmReply({
      ctx,
      psid: params.psid,
      command,
      pending: session?.pending,
    })) {
      return;
    }

    const jobs = await requireSessionJobs(ctx);

    if (command.kind === "start") {
      await handleStartCommand({ ctx, jobs, target: command.target });
      return;
    }

    if (command.kind === "done") {
      await handleDoneCommand({
        ctx,
        psid: params.psid,
        jobs,
        target: command.target,
        targets: command.targets,
        groupNumber: command.groupNumber,
        cashAmount: command.cashAmount,
      });
      return;
    }

    if (command.kind === "fail" || command.kind === "cancel") {
      await handleFailOrCancelCommand({
        ctx,
        psid: params.psid,
        jobs,
        kind: command.kind,
        target: command.target,
        targets: command.targets,
        groupNumber: command.groupNumber,
      });
      return;
    }

    if (command.kind === "details") {
      await handleDetailsCommand({
        ctx,
        psid: params.psid,
        target: command.target,
      });
      return;
    }

    if (command.kind === "order") {
      await handleOrderCommand({
        ctx,
        psid: params.psid,
        target: command.target,
        orderType: command.orderType,
        orderQty: command.orderQty,
        orderLines: command.orderLines,
        orderRaw: command.orderRaw,
      });
      return;
    }

    if (command.kind === "claim") {
      await handleClaimCommand({
        ctx,
        psid: params.psid,
        jobs,
        target: command.target,
      });
      return;
    }

    if (command.kind === "report") {
      await handleReportCommand({
        ctx,
        psid: params.psid,
        jobs,
        target: command.target,
      });
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

    await replyRiderMessengerLinked({
      ...ctx,
      body: `Hindi ko maintindihan ang "${params.text.slice(0, 80)}".\n\n${buildRiderMessengerHelpText()}`,
    });
  } catch (error) {
    const message =
      error instanceof RiderMessengerTransactionError ?
        error.message :
        "May error. Try ulit o i-send ang HELP.";
    logger.warn("handleRiderMessengerInboundText failed", { error, psid: params.psid });
    await replyRiderMessengerLinked({ ...ctx, body: message });
  }
}
