import { db, FieldValue } from "../../config/firebase-admin";

const MANILA_TZ = "Asia/Manila";

function manilaMonthKey(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

type ChannelUsageWithCommunity = {
  periodKey?: string;
  communityOrdersAccepted?: number;
};

/** CP-26 — per-station community Messenger accepts this month. */
export async function readCommunityOrdersAcceptedThisMonth(
  businessId: string,
  now = new Date(),
): Promise<number> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const raw = snap.data()?.channelUsage as ChannelUsageWithCommunity | undefined;
  const periodKey = manilaMonthKey(now);
  if (!raw || raw.periodKey !== periodKey) return 0;
  return Math.max(0, Number(raw.communityOrdersAccepted) || 0);
}

export async function incrementCommunityOrdersAccepted(
  businessId: string,
  amount = 1,
): Promise<number> {
  const delta = Math.max(1, Math.floor(amount));
  const periodKey = manilaMonthKey();
  const ref = db.collection("businesses").doc(businessId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.data()?.channelUsage as Record<string, unknown> | undefined;
    const current =
      existing?.periodKey === periodKey ?
        Math.max(0, Number(existing.communityOrdersAccepted) || 0) :
        0;
    const next = current + delta;
    tx.set(
      ref,
      {
        channelUsage: {
          ...(existing?.periodKey === periodKey ? existing : {}),
          periodKey,
          communityOrdersAccepted: next,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    return next;
  });
}
