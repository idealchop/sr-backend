import { sendRiderMessengerPrefixedText } from "../meta/meta-rider-messenger-send-service";
import {
  replyRiderMessengerLinked,
  type RiderMessengerCtx,
} from "./rider-messenger-reply";
import { RiderMessengerLinkService } from "./rider-messenger-link-service";
import {
  parseRiderMessengerCommand,
  parseRiderMessengerPostback,
} from "./rider-messenger-command-service";
import {
  buildRiderMessengerConfirmDoneMessage,
  buildRiderMessengerJobNotFoundMessage,
  RIDER_MESSENGER_UNLINKED_HELP,
} from "./rider-messenger-copy";
import {
  formatNearbyIndexMessage,
  loadRiderMessengerNearbyGroups,
} from "./rider-messenger-nearby-service";
import {
  downloadMessengerImageAttachment,
  uploadRiderMessengerDeliveryProof,
} from "./rider-messenger-proof-service";
import {
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import {
  loadRiderMessengerJobs,
  resolveJobTarget,
} from "./rider-messenger-jobs-service";
import {
  RIDER_MESSENGER_POSTBACK_CONFIRM_NO,
  RIDER_MESSENGER_POSTBACK_CONFIRM_YES,
  RIDER_MESSENGER_POSTBACK_HELP,
  RIDER_MESSENGER_POSTBACK_JOBS,
  RIDER_MESSENGER_POSTBACK_NEARBY,
} from "./rider-messenger-types";
import { handleRiderMessengerInboundText } from "./rider-messenger-inbound-text-service";

export { handleRiderMessengerInboundText };

export async function handleNearbyIndex(
  params: RiderMessengerCtx & { riderLat: number; riderLng: number },
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
  await replyRiderMessengerLinked({
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

export async function requireSessionJobs(params: {
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

export async function startDoneConfirm(ctx: RiderMessengerCtx, params: {
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
  await replyRiderMessengerLinked({
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

  const ctx: RiderMessengerCtx = {
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

  const ctx: RiderMessengerCtx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  const command = parseRiderMessengerCommand(params.caption ?? "");
  if (command.kind !== "done") {
    await replyRiderMessengerLinked({
      ...ctx,
      body: "Para sa proof photo, lagyan ng caption: DONE # (hal. DONE 2).",
    });
    return;
  }

  const jobs = await requireSessionJobs(ctx);
  const job = resolveJobTarget(jobs, command.target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }

  const downloaded = await downloadMessengerImageAttachment(params.imageUrl);
  if (!downloaded) {
    await replyRiderMessengerLinked({ ...ctx, body: "Hindi ma-download ang photo. Try ulit." });
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
