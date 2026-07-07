import {
  loadRiderMessengerJobs,
} from "./rider-messenger-jobs-service";
import type { RiderMessengerJobRow, RiderMessengerNearbyGroup } from "./rider-messenger-types";
import {
  TransactionService,
  type Transaction,
} from "../transactions/transaction-service";
import { resolveNearbyGroup } from "./rider-messenger-nearby-service";

export type GroupBulkTarget =
  | { scope: "single"; target: string }
  | { scope: "group"; groupNumber: string; cashAmount?: number };

export function parseGroupBulkTarget(arg: string): GroupBulkTarget | null {
  const trimmed = arg.trim();
  if (!trimmed) return null;

  const groupCashMatch = trimmed.match(
    /^GROUP\s+(\d+)(?:\s+CASH\s+(\d+(?:\.\d{1,2})?))?$/i,
  );
  if (groupCashMatch?.[1]) {
    const cashParsed = groupCashMatch[2] ?
      Number.parseFloat(groupCashMatch[2]) :
      undefined;
    const cashAmount =
      cashParsed != null && Number.isFinite(cashParsed) && cashParsed > 0 ?
        cashParsed :
        undefined;
    return {
      scope: "group",
      groupNumber: groupCashMatch[1],
      ...(cashAmount != null ? { cashAmount } : {}),
    };
  }

  return { scope: "single", target: trimmed };
}

export type GroupRiderJobRow = RiderMessengerJobRow & {
  customerId?: string;
};

function memberCustomerIds(group: RiderMessengerNearbyGroup): Set<string> {
  return new Set(group.members.map((m) => m.customerId));
}

function memberTransactionIds(group: RiderMessengerNearbyGroup): Set<string> {
  const ids = new Set<string>();
  for (const member of group.members) {
    if (member.transactionId) ids.add(member.transactionId);
  }
  return ids;
}

export function jobMatchesNearbyGroup(
  job: RiderMessengerJobRow,
  tx: Transaction | null,
  group: RiderMessengerNearbyGroup,
): boolean {
  if (memberTransactionIds(group).has(job.transactionId)) return true;
  const customerId = tx?.customerId;
  if (customerId && memberCustomerIds(group).has(customerId)) return true;
  return false;
}

export async function resolveGroupRiderTodoJobs(params: {
  businessId: string;
  riderId: string;
  group: RiderMessengerNearbyGroup;
  includeNonTodo?: boolean;
}): Promise<GroupRiderJobRow[]> {
  const jobs = await loadRiderMessengerJobs({
    businessId: params.businessId,
    riderId: params.riderId,
    filter: "all",
  });

  const matched: GroupRiderJobRow[] = [];
  for (const job of jobs) {
    if (!params.includeNonTodo && !job.isTodo) continue;
    const tx = await TransactionService.getTransaction(
      params.businessId,
      job.transactionId,
    );
    if (!tx || tx.riderId !== params.riderId) continue;
    if (["completed", "cancelled", "failed"].includes(String(tx.deliveryStatus))) {
      continue;
    }
    if (!jobMatchesNearbyGroup(job, tx, params.group)) continue;
    matched.push({
      ...job,
      customerId: tx.customerId,
    });
  }
  return matched;
}

export function isEligibleForGroupBulkDone(
  job: RiderMessengerJobRow,
  tx: Transaction,
): boolean {
  if (!job.isTodo) return false;
  if (job.type === "delivery") return true;
  const items = tx.collectionItems ?? [];
  if (!items.length) return true;
  return items.every(
    (item) =>
      item.status !== "pending" ||
      (Number(item.qtyCollected) || 0) > 0 ||
      (Number(item.qtyOk) || 0) > 0,
  );
}

export async function resolveGroupBulkDoneJobs(params: {
  businessId: string;
  riderId: string;
  group: RiderMessengerNearbyGroup;
}): Promise<Array<{ job: GroupRiderJobRow; tx: Transaction }>> {
  const todos = await resolveGroupRiderTodoJobs(params);
  const eligible: Array<{ job: GroupRiderJobRow; tx: Transaction }> = [];
  const blockedCollections: GroupRiderJobRow[] = [];

  for (const job of todos) {
    const tx = await TransactionService.getTransaction(
      params.businessId,
      job.transactionId,
    );
    if (!tx) continue;
    if (isEligibleForGroupBulkDone(job, tx)) {
      eligible.push({ job, tx });
    } else if (job.type === "collection") {
      blockedCollections.push(job);
    }
  }

  return eligible;
}

export function resolveGroupFromSession(
  groups: RiderMessengerNearbyGroup[] | undefined,
  groupNumberToken: string,
): RiderMessengerNearbyGroup | null {
  if (!groups?.length) return null;
  return resolveNearbyGroup(groups, groupNumberToken);
}

export function formatGroupBulkDoneConfirmMessage(params: {
  group: RiderMessengerNearbyGroup;
  jobs: Array<{ job: GroupRiderJobRow; tx: Transaction }>;
  blockedCollections?: GroupRiderJobRow[];
  cashAmount?: number;
}): string {
  const lines: string[] = [
    `✅ DONE GROUP ${params.group.groupNumber} · ${params.group.label}`,
    `${params.jobs.length} job${params.jobs.length === 1 ? "" : "s"} — walang issue?`,
    "",
  ];
  for (const { job } of params.jobs.slice(0, 10)) {
    lines.push(`• ${job.referenceId} · ${job.customerName}`);
  }
  if (params.blockedCollections?.length) {
    lines.push("");
    lines.push(
      `⚠️ ${params.blockedCollections.length} collection — REPORT # muna bago DONE:`,
    );
    for (const job of params.blockedCollections.slice(0, 5)) {
      lines.push(`• ${job.referenceId}`);
    }
  }
  if (params.cashAmount != null && params.cashAmount > 0) {
    lines.push("");
    lines.push(`Cash total split: ₱${params.cashAmount.toLocaleString("en-PH")} (hati sa jobs)`);
  }
  lines.push("");
  lines.push("I-send YES para i-confirm · NO para cancel");
  return lines.join("\n").slice(0, 1900);
}

export function formatGroupBulkReasonPrompt(params: {
  group: RiderMessengerNearbyGroup;
  jobs: GroupRiderJobRow[];
  targetStatus: "failed" | "cancelled";
  reasonListMessage: string;
}): string {
  const statusLabel = params.targetStatus === "failed" ? "Failed" : "Cancelled";
  const lines: string[] = [
    `${statusLabel} GROUP ${params.group.groupNumber} · ${params.group.label}`,
    `${params.jobs.length} job${params.jobs.length === 1 ? "" : "s"}:`,
  ];
  for (const job of params.jobs.slice(0, 8)) {
    lines.push(`• ${job.referenceId} · ${job.customerName}`);
  }
  lines.push("");
  lines.push(params.reasonListMessage.split("\n").slice(2).join("\n"));
  return lines.join("\n").slice(0, 1900);
}

export function formatGroupBulkCompleteSummary(params: {
  groupNumber: number;
  groupLabel: string;
  referenceIds: string[];
  action: "done" | "failed" | "cancelled";
  reason?: string;
}): string {
  const verb =
    params.action === "done" ?
      "tapos" :
      params.action === "failed" ?
        "failed" :
        "cancelled";
  const lines: string[] = [
    `✅ GROUP ${params.groupNumber} · ${params.groupLabel} — ${params.referenceIds.length} job${params.referenceIds.length === 1 ? "" : "s"} ${verb}`,
  ];
  for (const ref of params.referenceIds.slice(0, 8)) {
    lines.push(`• ${ref}`);
  }
  if (params.reason) {
    lines.push("");
    lines.push(`Reason: ${params.reason}`);
  }
  lines.push("");
  lines.push("I-send ang JOBS para i-refresh.");
  return lines.join("\n").slice(0, 1900);
}

export function splitCashAcrossJobs(
  totalCash: number,
  count: number,
): number[] {
  if (count <= 0 || totalCash <= 0) return [];
  const cents = Math.round(totalCash * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, idx) =>
    (base + (idx < remainder ? 1 : 0)) / 100,
  );
}
