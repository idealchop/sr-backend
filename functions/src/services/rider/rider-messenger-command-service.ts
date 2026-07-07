import type { CommunityOrderLine } from "../meta/community-dispatch-template-parser";
import { parseGroupBulkTarget } from "./rider-messenger-group-actions-service";
import { parseMultiJobTargets } from "./rider-messenger-multi-target-service";
import { parseRiderMessengerOrderArg } from "./rider-messenger-order-service";

export type RiderMessengerCommand =
  | { kind: "link"; code: string }
  | { kind: "jobs"; filter: "all" | "delivery" | "collection" }
  | { kind: "start"; target: string; groupNumber?: string }
  | {
    kind: "done";
    target: string;
    targets?: string[];
    groupNumber?: string;
    cashAmount?: number;
  }
  | { kind: "fail"; target: string; targets?: string[]; groupNumber?: string }
  | { kind: "cancel"; target: string; targets?: string[]; groupNumber?: string }
  | { kind: "reason"; index: number; detail?: string }
  | { kind: "claim"; target: string }
  | { kind: "report"; target: string }
  | { kind: "help" }
  | { kind: "stats" }
  | { kind: "nearby" }
  | { kind: "group"; target: string }
  | { kind: "details"; target: string }
  | {
    kind: "order";
    target: string;
    orderType?: "delivery" | "collection";
    orderQty?: number;
    orderLines?: CommunityOrderLine[];
    orderRaw?: string;
  }
  | { kind: "confirm_yes" }
  | { kind: "confirm_no" }
  | { kind: "chat_open" }
  | { kind: "chat_close" }
  | { kind: "unknown"; raw: string };

function parseActionTarget(
  arg: string,
): { target: string; targets?: string[]; groupNumber?: string; cashAmount?: number } {
  const bulk = parseGroupBulkTarget(arg);
  if (!bulk) return { target: arg };
  if (bulk.scope === "group") {
    return {
      target: `GROUP ${bulk.groupNumber}`,
      groupNumber: bulk.groupNumber,
      ...(bulk.cashAmount != null ? { cashAmount: bulk.cashAmount } : {}),
    };
  }
  const multi = parseMultiJobTargets(bulk.target);
  if (multi?.length) {
    return { target: multi.join(","), targets: multi };
  }
  return { target: bulk.target };
}

function parseDoneTarget(rawArg: string): {
  target: string;
  targets?: string[];
  groupNumber?: string;
  cashAmount?: number;
} {
  const groupBulk = parseGroupBulkTarget(rawArg);
  if (groupBulk?.scope === "group") {
    return {
      target: `GROUP ${groupBulk.groupNumber}`,
      groupNumber: groupBulk.groupNumber,
      ...(groupBulk.cashAmount != null ? { cashAmount: groupBulk.cashAmount } : {}),
    };
  }

  const cashMatch = rawArg.match(/^(.+?)\s+CASH\s+(\d+(?:\.\d{1,2})?)$/i);
  let body = rawArg;
  let cashAmount: number | undefined;
  if (cashMatch) {
    body = cashMatch[1]?.trim() ?? rawArg;
    const amount = Number.parseFloat(cashMatch[2] ?? "");
    cashAmount = Number.isFinite(amount) && amount > 0 ? amount : undefined;
  }

  const multi = parseMultiJobTargets(body);
  if (multi?.length) {
    return {
      target: multi.join(","),
      targets: multi,
      ...(cashAmount != null ? { cashAmount } : {}),
    };
  }

  return { target: body, ...(cashAmount != null ? { cashAmount } : {}) };
}

export function parseRiderMessengerCommand(input: string): RiderMessengerCommand {
  const raw = input.trim();
  if (!raw) return { kind: "unknown", raw: "" };

  const upper = raw.toUpperCase();

  if (upper === "HELP" || upper === "MENU") return { kind: "help" };
  if (upper === "YES" || upper === "OO" || upper === "CONFIRM") return { kind: "confirm_yes" };
  if (upper === "NO" || upper === "HINDI") return { kind: "confirm_no" };
  if (upper === "CLOSE CHAT" || upper === "CLOSECHAT") return { kind: "chat_close" };
  if (upper === "CHAT") return { kind: "chat_open" };
  if (upper === "STATS") return { kind: "stats" };
  if (upper === "NEARBY") return { kind: "nearby" };

  const parts = raw.split(/\s+/);
  const verb = parts[0]?.toUpperCase() ?? "";
  const arg = parts.slice(1).join(" ").trim();

  if (verb === "GROUP" && arg) return { kind: "group", target: arg };
  if (verb === "GROUP") return { kind: "unknown", raw: "GROUP" };

  if (verb === "LINK" && arg) return { kind: "link", code: arg };
  if (verb === "JOBS") {
    const filterArg = parts[1]?.toUpperCase();
    if (filterArg === "DELIVERY") return { kind: "jobs", filter: "delivery" };
    if (filterArg === "COLLECTION") return { kind: "jobs", filter: "collection" };
    return { kind: "jobs", filter: "all" };
  }
  if (verb === "START" && arg) {
    const parsed = parseActionTarget(arg);
    return {
      kind: "start",
      target: parsed.target,
      ...(parsed.groupNumber ? { groupNumber: parsed.groupNumber } : {}),
    };
  }
  if (verb === "DONE" && arg) {
    const parsed = parseDoneTarget(arg);
    return {
      kind: "done",
      target: parsed.target,
      ...(parsed.targets?.length ? { targets: parsed.targets } : {}),
      ...(parsed.groupNumber ? { groupNumber: parsed.groupNumber } : {}),
      ...(parsed.cashAmount != null ? { cashAmount: parsed.cashAmount } : {}),
    };
  }
  if (verb === "FAIL" && arg) {
    const parsed = parseActionTarget(arg);
    return {
      kind: "fail",
      target: parsed.target,
      ...(parsed.targets?.length ? { targets: parsed.targets } : {}),
      ...(parsed.groupNumber ? { groupNumber: parsed.groupNumber } : {}),
    };
  }
  if (verb === "CANCEL" && arg) {
    const parsed = parseActionTarget(arg);
    return {
      kind: "cancel",
      target: parsed.target,
      ...(parsed.targets?.length ? { targets: parsed.targets } : {}),
      ...(parsed.groupNumber ? { groupNumber: parsed.groupNumber } : {}),
    };
  }
  if (verb === "REASON" && arg) {
    const match = arg.match(/^(\d+)(?:\s*[-–—:]\s*(.+))?$/);
    if (!match?.[1]) return { kind: "unknown", raw };
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || index < 1) return { kind: "unknown", raw };
    const detail = match[2]?.trim();
    return {
      kind: "reason",
      index,
      ...(detail ? { detail } : {}),
    };
  }
  if (verb === "CLAIM" && arg) return { kind: "claim", target: arg };
  if (verb === "REPORT" && arg) return { kind: "report", target: arg };
  if (verb === "DETAILS" && arg) return { kind: "details", target: arg };
  if (verb === "ORDER" && arg) {
    const parsed = parseRiderMessengerOrderArg(arg);
    if (!parsed) return { kind: "unknown", raw };
    return {
      kind: "order",
      target: parsed.target,
      ...(parsed.type ? { orderType: parsed.type } : {}),
      ...(parsed.qty != null ? { orderQty: parsed.qty } : {}),
      ...(parsed.orderLines?.length ? { orderLines: parsed.orderLines } : {}),
      ...(parsed.orderRaw ? { orderRaw: parsed.orderRaw } : {}),
    };
  }

  return { kind: "unknown", raw };
}

export function parseRiderMessengerPostback(payload: string): RiderMessengerCommand | null {
  const p = payload.trim();
  if (p === "RD_CONFIRM_YES") return { kind: "confirm_yes" };
  if (p === "RD_CONFIRM_NO") return { kind: "confirm_no" };
  if (p === "RD_JOBS") return { kind: "jobs", filter: "all" };
  if (p === "RD_NEARBY") return { kind: "nearby" };
  if (p === "RD_HELP") return { kind: "help" };
  return null;
}
