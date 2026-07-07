export type RiderMessengerStatusReason = {
  id: string;
  label: string;
  requiresNotes?: boolean;
};

/** Align with frontend `DELIVERY_FAIL_REASONS` (short Taglish labels for Messenger). */
export const RIDER_MESSENGER_FAIL_REASONS: RiderMessengerStatusReason[] = [
  {
    id: "customer_unavailable",
    label: "Customer unavailable / wala sa bahay",
  },
  {
    id: "address_inaccessible",
    label: "Maling address o hindi maabot",
  },
  {
    id: "unable_to_accommodate_reschedule_today",
    label: "Hindi ma-accommodate — i-reschedule today",
  },
  {
    id: "other",
    label: "Other",
    requiresNotes: true,
  },
];

export const RIDER_MESSENGER_CANCEL_REASONS: RiderMessengerStatusReason[] = [
  {
    id: "customer_requested",
    label: "Customer nag-request ng cancel",
  },
  {
    id: "duplicate_wrong_order",
    label: "Duplicate / maling order",
  },
  {
    id: "cannot_reach_customer",
    label: "Hindi ma-contact ang customer",
  },
  {
    id: "cannot_fulfill_today",
    label: "Hindi ma-fulfill ngayong araw",
  },
  {
    id: "other",
    label: "Other",
    requiresNotes: true,
  },
];

export function getRiderMessengerStatusReasons(
  targetStatus: "failed" | "cancelled",
): RiderMessengerStatusReason[] {
  return targetStatus === "failed" ?
    RIDER_MESSENGER_FAIL_REASONS :
    RIDER_MESSENGER_CANCEL_REASONS;
}

export function resolveRiderMessengerStatusReason(
  targetStatus: "failed" | "cancelled",
  index: number,
): RiderMessengerStatusReason | null {
  if (!Number.isFinite(index) || index < 1) return null;
  const list = getRiderMessengerStatusReasons(targetStatus);
  return list[index - 1] ?? null;
}

export function parseReasonCommand(text: string): { index: number; detail?: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^REASON\s+(\d+)(?:\s*[-–—:]\s*(.+))?$/i);
  if (!match?.[1]) return null;
  const index = Number.parseInt(match[1], 10);
  if (!Number.isFinite(index) || index < 1) return null;
  const detail = match[2]?.trim();
  return detail ? { index, detail } : { index };
}

export function formatStatusReasonNotes(label: string, detail?: string): string {
  const trimmed = detail?.trim();
  if (trimmed) return `${label} — ${trimmed}`;
  return label;
}

export function buildRiderMessengerReasonListMessage(params: {
  targetStatus: "failed" | "cancelled";
  referenceId: string;
}): string {
  const statusLabel = params.targetStatus === "failed" ? "Failed" : "Cancelled";
  const reasons = getRiderMessengerStatusReasons(params.targetStatus);
  const lines: string[] = [
    `${statusLabel} · ${params.referenceId}`,
    "",
    "Piliin ang reason:",
  ];
  reasons.forEach((reason, idx) => {
    lines.push(`${idx + 1}. ${reason.label}`);
  });
  lines.push("");
  lines.push("I-send REASON # (hal. REASON 1)");
  lines.push("O i-type ang sarili mong reason (free text).");
  return lines.join("\n");
}

export function buildRiderMessengerOtherReasonDetailPrompt(params: {
  referenceId: string;
}): string {
  return [
    `Other reason · ${params.referenceId}`,
    "",
    "I-send ang details (free text).",
    "Hal: stuck sa traffic · customer nagpa-cancel via text",
  ].join("\n");
}
