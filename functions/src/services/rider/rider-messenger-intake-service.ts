import { logger } from "../observability/logging/logger";
import {
  sendMetaRiderMessengerQuickReplies,
  sendRiderMessengerPrefixedText,
} from "../meta/meta-rider-messenger-send-service";
import { RiderMessengerLinkService } from "./rider-messenger-link-service";
import {
  parseRiderMessengerCommand,
  parseRiderMessengerPostback,
  RIDER_MESSENGER_HELP_TEXT,
} from "./rider-messenger-command-service";
import {
  formatJobsListMessage,
  loadRiderMessengerJobs,
  resolveJobTarget,
} from "./rider-messenger-jobs-service";
import {
  clearRiderMessengerPending,
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import {
  claimRiderMessengerJob,
  patchRiderMessengerTransaction,
  RiderMessengerTransactionError,
} from "./rider-messenger-transaction-service";
import {
  RIDER_MESSENGER_POSTBACK_CONFIRM_NO,
  RIDER_MESSENGER_POSTBACK_CONFIRM_YES,
  RIDER_MESSENGER_POSTBACK_HELP,
  RIDER_MESSENGER_POSTBACK_JOBS,
} from "./rider-messenger-types";

const UNLINKED_HELP =
  "Send LINK followed by your code from the owner (example: LINK RDR-7K2M). Use the same Messenger Page as customer orders.";

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

async function handleJobs(params: {
  psid: string;
  businessId: string;
  riderId: string;
  riderName: string;
  stationLabel: string;
  filter: "all" | "delivery" | "collection";
}): Promise<void> {
  const jobs = await loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: params.filter,
  });
  await saveRiderMessengerSession({
    psid: params.psid,
    businessId: params.businessId,
    riderId: params.riderId,
    lastJobs: jobs,
    pending: null,
  });
  await replyLinked({
    psid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: formatJobsListMessage(jobs),
    quickReplies: [
      { title: "JOBS", payload: RIDER_MESSENGER_POSTBACK_JOBS },
      { title: "HELP", payload: RIDER_MESSENGER_POSTBACK_HELP },
    ],
  });
}

async function requireSessionJobs(params: {
  psid: string;
  businessId: string;
  riderId: string;
}): Promise<ReturnType<typeof loadRiderMessengerJobs>> {
  const session = await getRiderMessengerSession(params.psid);
  if (session?.lastJobs?.length) return session.lastJobs;
  return loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: "all",
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
        body: "✅ Linked!\nSend JOBS for today's list.",
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
      body: UNLINKED_HELP,
    });
    return;
  }

  const ctx = {
    psid: params.psid,
    businessId: linked.businessId,
    riderId: linked.riderId,
    riderName: linked.riderName,
    stationLabel: linked.stationLabel,
    metaMessageId: params.metaMessageId,
  };

  try {
    if (command.kind === "help") {
      await replyLinked({ ...ctx, body: RIDER_MESSENGER_HELP_TEXT });
      return;
    }

    if (command.kind === "jobs") {
      await handleJobs({ ...ctx, filter: command.filter });
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
        body: `Today: ${done} done · ${todo} remaining`,
      });
      return;
    }

    const session = await getRiderMessengerSession(params.psid);

    if (session?.pending?.kind === "await_reason" && command.kind === "unknown" && params.text.trim()) {
      const pending = session.pending;
      const notesPrefix = pending.targetStatus === "failed" ? "Status Reason: " : "Status Reason: ";
      await patchRiderMessengerTransaction({
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        psid: params.psid,
        transactionId: pending.transactionId,
        updates: {
          deliveryStatus: pending.targetStatus,
          notes: notesPrefix + params.text.trim(),
          ...(pending.targetStatus === "failed" || pending.targetStatus === "cancelled" ?
            {
              totalAmount: 0,
              amountPaid: 0,
              balanceDue: 0,
              paymentStatus: "N/A" as const,
              payments: [],
            } :
            {}),
        },
        metaMessageId: params.metaMessageId,
        action: pending.targetStatus ?? "status",
      });
      await clearRiderMessengerPending(params.psid);
      await replyLinked({ ...ctx, body: `Marked as ${pending.targetStatus}. Send JOBS to refresh.` });
      return;
    }

    if (command.kind === "confirm_yes" && session?.pending?.kind === "confirm_done") {
      await patchRiderMessengerTransaction({
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        psid: params.psid,
        transactionId: session.pending.transactionId,
        updates: { deliveryStatus: "completed" },
        metaMessageId: params.metaMessageId,
        action: "done",
      });
      await clearRiderMessengerPending(params.psid);
      await replyLinked({ ...ctx, body: "✅ Completed! Send JOBS to refresh." });
      return;
    }

    if (command.kind === "confirm_no") {
      await clearRiderMessengerPending(params.psid);
      await replyLinked({ ...ctx, body: "Cancelled. Send JOBS to see your list." });
      return;
    }

    const jobs = await requireSessionJobs({
      psid: params.psid,
      businessId: ctx.businessId,
      riderId: ctx.riderId,
    });

    if (command.kind === "start") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: "Job not found. Send JOBS first, then START with the number." });
        return;
      }
      await patchRiderMessengerTransaction({
        ...ctx,
        transactionId: job.transactionId,
        updates: { deliveryStatus: "in-transit" },
        action: "start",
      });
      const phoneLine = job.phone ? `\n📞 ${job.phone}` : "";
      await replyLinked({
        ...ctx,
        body: `🚚 In transit: ${job.customerName} (${job.referenceId})${phoneLine}`,
      });
      return;
    }

    if (command.kind === "done") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: "Job not found. Send JOBS first." });
        return;
      }
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        lastJobs: jobs,
        pending: { kind: "confirm_done", transactionId: job.transactionId },
      });
      await replyLinked({
        ...ctx,
        body: `Mark ${job.customerName} (${job.referenceId}) as COMPLETED?`,
        quickReplies: [
          { title: "YES", payload: RIDER_MESSENGER_POSTBACK_CONFIRM_YES },
          { title: "NO", payload: RIDER_MESSENGER_POSTBACK_CONFIRM_NO },
        ],
      });
      return;
    }

    if (command.kind === "fail" || command.kind === "cancel") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: "Job not found. Send JOBS first." });
        return;
      }
      const targetStatus = command.kind === "fail" ? "failed" : "cancelled";
      await saveRiderMessengerSession({
        psid: params.psid,
        businessId: ctx.businessId,
        riderId: ctx.riderId,
        lastJobs: jobs,
        pending: {
          kind: "await_reason",
          transactionId: job.transactionId,
          targetStatus,
        },
      });
      await replyLinked({
        ...ctx,
        body: `Reply with reason for ${targetStatus} (${job.referenceId}):`,
      });
      return;
    }

    if (command.kind === "claim") {
      const job = resolveJobTarget(jobs, command.target);
      if (!job) {
        await replyLinked({ ...ctx, body: "Job not found. Send JOBS first." });
        return;
      }
      await claimRiderMessengerJob({
        ...ctx,
        transactionId: job.transactionId,
      });
      await replyLinked({ ...ctx, body: `Claimed ${job.referenceId}. Send JOBS to refresh.` });
      return;
    }

    if (command.kind === "report") {
      await replyLinked({
        ...ctx,
        body: "Collection REPORT wizard coming soon. Use the app Report button for now, or complete with DONE #.",
      });
      return;
    }

    await replyLinked({
      ...ctx,
      body: `Did not understand "${params.text.slice(0, 80)}".\n\n${RIDER_MESSENGER_HELP_TEXT}`,
    });
  } catch (error) {
    const message =
      error instanceof RiderMessengerTransactionError ?
        error.message :
        "Something went wrong. Try again or send HELP.";
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

  return false;
}
