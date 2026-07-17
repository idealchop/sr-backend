import type { RiderMessengerCtx } from "./rider-messenger-reply";
import { replyRiderMessengerLinked } from "./rider-messenger-reply";
import { TransactionService } from "../transactions/transaction-service";
import {
  buildRiderMessengerJobNotFoundMessage,
  buildRiderMessengerReportSavedMessage,
  buildRiderMessengerReportStartMessage,
} from "./rider-messenger-copy";
import {
  applyReportBreakdownToCollectionItem,
  findNextUnreportedCollectionIndex,
  formatReportItemAck,
  formatReportNeedContainerMessage,
  parseReportBreakdownReply,
  resolveReportTargetIndex,
} from "./rider-messenger-report-service";
import {
  clearRiderMessengerPending,
  getRiderMessengerSession,
  saveRiderMessengerSession,
} from "./rider-messenger-session-service";
import { resolveJobTarget } from "./rider-messenger-jobs-service";
import { patchRiderMessengerTransaction } from "./rider-messenger-transaction-service";
import type {
  RiderMessengerJobRow,
  RiderMessengerSessionPending,
} from "./rider-messenger-types";

export async function promptReportItem(
  ctx: RiderMessengerCtx,
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
  await replyRiderMessengerLinked({
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

export async function handleReportQtyReply(
  ctx: RiderMessengerCtx,
  qtyText: string,
): Promise<boolean> {
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
    await replyRiderMessengerLinked({
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
    await replyRiderMessengerLinked({
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
    await replyRiderMessengerLinked({
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
  await replyRiderMessengerLinked({
    ...ctx,
    body: [
      `${updated.name}: ${formatReportItemAck(updated)}`,
      buildRiderMessengerReportSavedMessage(),
    ].join("\n"),
  });
  return true;
}

export async function handleReportCommand(params: {
  ctx: RiderMessengerCtx;
  psid: string;
  jobs: RiderMessengerJobRow[];
  target: string;
}): Promise<void> {
  const { ctx, psid, jobs, target } = params;
  const job = resolveJobTarget(jobs, target);
  if (!job) {
    await replyRiderMessengerLinked({ ...ctx, body: buildRiderMessengerJobNotFoundMessage() });
    return;
  }
  const tx = await TransactionService.getTransaction(ctx.businessId, job.transactionId);
  if (!tx || tx.type !== "collection") {
    await replyRiderMessengerLinked({ ...ctx, body: "REPORT ay para sa collection jobs lang." });
    return;
  }
  const items = tx.collectionItems ?? [];
  if (!items.length) {
    await replyRiderMessengerLinked({ ...ctx, body: "Walang collection items sa job na ito." });
    return;
  }
  const pending = {
    kind: "report_collect" as const,
    transactionId: job.transactionId,
    items,
    nextIndex: 0,
  };
  await saveRiderMessengerSession({
    psid,
    businessId: ctx.businessId,
    riderId: ctx.riderId,
    lastJobs: jobs,
    pending,
  });
  await promptReportItem(ctx, pending);
}
