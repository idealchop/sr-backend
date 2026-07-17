import {
  isEligibleForGroupBulkDone,
  splitCashAcrossJobs,
} from "./rider-messenger-group-actions-service";
import {
  resolveJobTarget,
} from "./rider-messenger-jobs-service";
import type { RiderMessengerJobRow } from "./rider-messenger-types";
import { TransactionService, type Transaction } from "../transactions/transaction-service";

const MAX_MULTI_TARGET_RANGE = 50;

function expandTargetSegment(segment: string): string[] {
  const trimmed = segment.trim();
  if (!trimmed) return [];

  const rangeMatch = trimmed.match(/^(\d+)\s*(?:to|-)\s*(\d+)$/i);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
      return [trimmed];
    }
    if (end < start) return [];
    if (end - start + 1 > MAX_MULTI_TARGET_RANGE) return [];
    return Array.from({ length: end - start + 1 }, (_, idx) => String(start + idx));
  }

  return [trimmed];
}

export function parseMultiJobTargets(rawArg: string): string[] | null {
  const trimmed = rawArg.trim();
  if (!trimmed) return null;

  const hasComma = trimmed.includes(",");
  const hasRange = /\d+\s*(?:to|-)\s*\d+/i.test(trimmed);
  if (!hasComma && !hasRange) return null;

  const tokens: string[] = [];
  for (const segment of trimmed.split(",")) {
    tokens.push(...expandTargetSegment(segment.trim()));
  }

  const seen = new Set<string>();
  const unique = tokens.filter((token) => {
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });

  return unique.length > 1 ? unique : null;
}

export function resolveJobTargets(
  jobs: RiderMessengerJobRow[],
  tokens: string[],
): { resolved: RiderMessengerJobRow[]; missing: string[] } {
  const resolved: RiderMessengerJobRow[] = [];
  const missing: string[] = [];
  const seenTransactionIds = new Set<string>();

  for (const token of tokens) {
    const job = resolveJobTarget(jobs, token);
    if (!job) {
      missing.push(token);
      continue;
    }
    if (seenTransactionIds.has(job.transactionId)) continue;
    seenTransactionIds.add(job.transactionId);
    resolved.push(job);
  }

  return { resolved, missing };
}

export function formatMultiTargetLabel(tokens: string[]): string {
  const numeric = tokens.every((token) => /^\d+$/.test(token));
  if (numeric && tokens.length >= 2) {
    const nums = tokens.map((token) => Number.parseInt(token, 10));
    const sorted = [...nums].sort((a, b) => a - b);
    const isConsecutive =
      sorted.length === nums.length &&
      sorted.every((value, idx) => {
        if (idx === 0) return true;
        const prev = sorted[idx - 1];
        return prev != null && value === prev + 1;
      });
    if (isConsecutive) {
      return `#${sorted[0]}–#${sorted[sorted.length - 1]}`;
    }
  }
  return tokens.map((token) => `#${token}`).join(", ");
}

export async function resolveMultiBulkDoneJobs(params: {
  businessId: string;
  jobs: RiderMessengerJobRow[];
  tokens: string[];
}): Promise<{
  eligible: Array<{ job: RiderMessengerJobRow; tx: Transaction }>;
  blockedCollections: RiderMessengerJobRow[];
  missing: string[];
}> {
  const { resolved, missing } = resolveJobTargets(params.jobs, params.tokens);
  const eligible: Array<{ job: RiderMessengerJobRow; tx: Transaction }> = [];
  const blockedCollections: RiderMessengerJobRow[] = [];

  for (const job of resolved) {
    const tx = await TransactionService.getTransaction(
      params.businessId,
      job.transactionId,
    );
    if (!tx) {
      missing.push(String(job.index));
      continue;
    }
    if (isEligibleForGroupBulkDone(job, tx)) {
      eligible.push({ job, tx });
    } else if (job.type === "collection") {
      blockedCollections.push(job);
    }
  }

  return { eligible, blockedCollections, missing };
}

export function formatMultiBulkDoneConfirmMessage(params: {
  targetLabel: string;
  jobs: Array<{ job: RiderMessengerJobRow; tx: Transaction }>;
  blockedCollections?: RiderMessengerJobRow[];
  missing?: string[];
  cashAmount?: number;
}): string {
  const lines: string[] = [
    `✅ DONE ${params.targetLabel}`,
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
  if (params.missing?.length) {
    lines.push("");
    lines.push(`Hindi mahanap: ${params.missing.map((token) => `#${token}`).join(", ")}`);
  }
  if (params.cashAmount != null && params.cashAmount > 0) {
    lines.push("");
    lines.push(
      `Cash total split: ₱${params.cashAmount.toLocaleString("en-PH")} (hati sa jobs)`,
    );
  }
  lines.push("");
  lines.push("I-send YES para i-confirm · NO para cancel");
  return lines.join("\n").slice(0, 1900);
}

export function formatMultiBulkReasonPrompt(params: {
  targetLabel: string;
  jobs: RiderMessengerJobRow[];
  targetStatus: "failed" | "cancelled";
  reasonListMessage: string;
  missing?: string[];
}): string {
  const statusLabel = params.targetStatus === "failed" ? "Failed" : "Cancelled";
  const lines: string[] = [
    `${statusLabel} ${params.targetLabel}`,
    `${params.jobs.length} job${params.jobs.length === 1 ? "" : "s"}:`,
  ];
  for (const job of params.jobs.slice(0, 8)) {
    lines.push(`• ${job.referenceId} · ${job.customerName}`);
  }
  if (params.missing?.length) {
    lines.push("");
    lines.push(`Hindi mahanap: ${params.missing.map((token) => `#${token}`).join(", ")}`);
  }
  lines.push("");
  lines.push(params.reasonListMessage.split("\n").slice(2).join("\n"));
  return lines.join("\n").slice(0, 1900);
}

export function formatMultiBulkCompleteSummary(params: {
  targetLabel: string;
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
    `✅ ${params.targetLabel} — ${params.referenceIds.length} job${params.referenceIds.length === 1 ? "" : "s"} ${verb}`,
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

export { splitCashAcrossJobs };
