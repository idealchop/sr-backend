export type RiderMessengerCommand =
  | { kind: "link"; code: string }
  | { kind: "jobs"; filter: "all" | "delivery" | "collection" }
  | { kind: "start"; target: string }
  | { kind: "done"; target: string }
  | { kind: "fail"; target: string }
  | { kind: "cancel"; target: string }
  | { kind: "claim"; target: string }
  | { kind: "report"; target: string }
  | { kind: "help" }
  | { kind: "stats" }
  | { kind: "confirm_yes" }
  | { kind: "confirm_no" }
  | { kind: "unknown"; raw: string };

export function parseRiderMessengerCommand(input: string): RiderMessengerCommand {
  const raw = input.trim();
  if (!raw) return { kind: "unknown", raw: "" };

  const upper = raw.toUpperCase();

  if (upper === "HELP" || upper === "MENU") return { kind: "help" };
  if (upper === "YES" || upper === "OO" || upper === "CONFIRM") return { kind: "confirm_yes" };
  if (upper === "NO" || upper === "HINDI") return { kind: "confirm_no" };
  if (upper === "STATS") return { kind: "stats" };

  const parts = raw.split(/\s+/);
  const verb = parts[0]?.toUpperCase() ?? "";
  const arg = parts.slice(1).join(" ").trim();

  if (verb === "LINK" && arg) return { kind: "link", code: arg };
  if (verb === "JOBS") {
    const filterArg = parts[1]?.toUpperCase();
    if (filterArg === "DELIVERY") return { kind: "jobs", filter: "delivery" };
    if (filterArg === "COLLECTION") return { kind: "jobs", filter: "collection" };
    return { kind: "jobs", filter: "all" };
  }
  if (verb === "START" && arg) return { kind: "start", target: arg };
  if (verb === "DONE" && arg) return { kind: "done", target: arg };
  if (verb === "FAIL" && arg) return { kind: "fail", target: arg };
  if (verb === "CANCEL" && arg) return { kind: "cancel", target: arg };
  if (verb === "CLAIM" && arg) return { kind: "claim", target: arg };
  if (verb === "REPORT" && arg) return { kind: "report", target: arg };

  return { kind: "unknown", raw };
}

export function parseRiderMessengerPostback(payload: string): RiderMessengerCommand | null {
  const p = payload.trim();
  if (p === "RD_CONFIRM_YES") return { kind: "confirm_yes" };
  if (p === "RD_CONFIRM_NO") return { kind: "confirm_no" };
  if (p === "RD_JOBS") return { kind: "jobs", filter: "all" };
  if (p === "RD_HELP") return { kind: "help" };
  return null;
}

export const RIDER_MESSENGER_HELP_TEXT = [
  "Commands:",
  "JOBS — today's list",
  "JOBS DELIVERY / JOBS COLLECTION",
  "START # — mark in-transit",
  "DONE # — mark completed",
  "FAIL # — failed (reason next)",
  "CANCEL # — cancelled (reason next)",
  "CLAIM # — assign unassigned job to you",
  "HELP — this menu",
].join("\n");
