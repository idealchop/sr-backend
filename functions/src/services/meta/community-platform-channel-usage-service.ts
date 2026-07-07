import { db, FieldValue } from "../../config/firebase-admin";

const PLATFORM_CHANNEL_USAGE_DOC = "platform/channel_usage";
const MANILA_TZ = "Asia/Manila";

function manilaPeriodKey(now = new Date()): string {
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

type PlatformChannelUsageDoc = {
  periodKey: string;
  communityMessengerIntake: number;
  communityWhatsappIntake?: number;
  communityViberIntake?: number;
  updatedAt?: unknown;
};

/**
 * CP-05 / CP-26 (partial) — platform-level community Messenger intake counter.
 */
export async function incrementCommunityMessengerIntake(amount = 1): Promise<number> {
  return incrementCommunityChannelIntake("community_messenger", amount);
}

export async function incrementCommunityWhatsappIntake(amount = 1): Promise<number> {
  return incrementCommunityChannelIntake("community_whatsapp", amount);
}

export async function incrementCommunityViberIntake(amount = 1): Promise<number> {
  return incrementCommunityChannelIntake("community_viber", amount);
}

export async function incrementCommunityChannelIntake(
  channel: "community_messenger" | "community_whatsapp" | "community_viber",
  amount = 1,
): Promise<number> {
  const delta = Math.max(1, Math.floor(amount));
  const periodKey = manilaPeriodKey();
  const ref = db.doc(PLATFORM_CHANNEL_USAGE_DOC);
  const field =
    channel === "community_whatsapp" ?
      "communityWhatsappIntake" :
      channel === "community_viber" ?
        "communityViberIntake" :
        "communityMessengerIntake";

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.data() as PlatformChannelUsageDoc | undefined;
    const current =
      raw?.periodKey === periodKey ?
        Math.max(0, Number(raw[field as keyof PlatformChannelUsageDoc]) || 0) :
        0;
    const next = current + delta;
    tx.set(
      ref,
      {
        periodKey,
        [field]: next,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return next;
  });
}
