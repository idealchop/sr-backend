import { db, FieldValue } from "../../config/firebase-admin";
import { trainingVideosCollection } from "./events-training-collections";

const DEFAULT_PREMIUM_PHP = 99;

export function videoUnlocksCollection(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("training_video_unlocks");
}

export function resolvePremiumUnlockPrice(data: Record<string, unknown>): number {
  // Sales Portal CMS stores premium price as integer cents.
  const cents = Number(data.priceCents);
  if (Number.isFinite(cents) && cents > 0) {
    return Math.round(cents) / 100;
  }
  const raw = Number(
    data.unlockPrice ?? data.pricePhp ?? data.price ?? DEFAULT_PREMIUM_PHP,
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PREMIUM_PHP;
  return Math.round(raw * 100) / 100;
}

export async function hasVideoUnlock(
  businessId: string,
  videoId: string,
): Promise<boolean> {
  if (!businessId || !videoId) return false;
  const snap = await videoUnlocksCollection(businessId).doc(videoId).get();
  if (!snap.exists) return false;
  const status = String(snap.data()?.status || "active");
  return status === "active";
}

export async function listUnlockedVideoIds(
  businessId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!businessId) return set;
  const snap = await videoUnlocksCollection(businessId).limit(200).get();
  for (const doc of snap.docs) {
    if (String(doc.data()?.status || "active") === "active") {
      set.add(doc.id);
    }
  }
  return set;
}

export async function grantVideoUnlock(input: {
  businessId: string;
  videoId: string;
  userId: string;
  intentId: string;
  amount: number;
  provider?: string;
}): Promise<void> {
  const ref = videoUnlocksCollection(input.businessId).doc(input.videoId);
  const now = FieldValue.serverTimestamp();
  await ref.set(
    {
      videoId: input.videoId,
      businessId: input.businessId,
      userId: input.userId,
      intentId: input.intentId,
      amount: input.amount,
      provider: input.provider || "paymongo",
      status: "active",
      unlockedAt: now,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
}

/**
 * Validate premium video + resolve checkout amount for unlock.
 */
export async function preparePremiumVideoUnlock(input: {
  videoId: string;
  businessId: string;
}): Promise<{
  videoId: string;
  name: string;
  amount: number;
  alreadyUnlocked: boolean;
}> {
  const snap = await trainingVideosCollection().doc(input.videoId).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Video not found."), { status: 404 });
  }
  const data = (snap.data() || {}) as Record<string, unknown>;
  const category = String(data.category || "");
  const status = String(data.status || "");
  const visibility = String(data.visibility || "public");
  if (category !== "webinar" && category !== "wrs_stories") {
    throw Object.assign(new Error("Only webinar recordings and stories can be unlocked."), {
      status: 400,
    });
  }
  if (status !== "published" && status !== "archived") {
    throw Object.assign(new Error("This video is not available."), { status: 400 });
  }
  if (visibility !== "premium") {
    throw Object.assign(new Error("This video is not a premium recording."), {
      status: 400,
    });
  }

  const alreadyUnlocked = await hasVideoUnlock(input.businessId, input.videoId);
  return {
    videoId: input.videoId,
    name: String(data.name || "").trim() || "Premium recording",
    amount: resolvePremiumUnlockPrice(data),
    alreadyUnlocked,
  };
}
