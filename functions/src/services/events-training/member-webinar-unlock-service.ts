import { db, FieldValue } from "../../config/firebase-admin";
import { webinarsCollection } from "./events-training-collections";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";

export function webinarUnlocksCollection(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("webinar_event_unlocks");
}

export async function hasWebinarUnlock(
  businessId: string,
  eventId: string,
): Promise<boolean> {
  if (!businessId || !eventId) return false;
  const snap = await webinarUnlocksCollection(businessId).doc(eventId).get();
  if (!snap.exists) return false;
  const status = String(snap.data()?.status || "active");
  return status === "active";
}

export async function listUnlockedWebinarIds(
  businessId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!businessId) return set;
  const snap = await webinarUnlocksCollection(businessId).limit(200).get();
  for (const doc of snap.docs) {
    if (String(doc.data()?.status || "active") === "active") {
      set.add(doc.id);
    }
  }
  return set;
}

export async function grantWebinarUnlock(input: {
  businessId: string;
  eventId: string;
  userId: string;
  intentId: string;
  amount: number;
  provider?: string;
}): Promise<void> {
  const ref = webinarUnlocksCollection(input.businessId).doc(input.eventId);
  const now = FieldValue.serverTimestamp();
  await ref.set(
    {
      eventId: input.eventId,
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
 * Validate premium live webinar + resolve checkout amount for unlock.
 */
export async function preparePremiumWebinarUnlock(input: {
  eventId: string;
  businessId: string;
}): Promise<{
  eventId: string;
  name: string;
  amount: number;
  alreadyUnlocked: boolean;
}> {
  const snap = await webinarsCollection().doc(input.eventId).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Webinar not found."), { status: 404 });
  }
  const data = (snap.data() || {}) as Record<string, unknown>;
  const status = String(data.status || "");
  const visibilityRaw = String(data.visibility ?? "private");
  const visibility =
    visibilityRaw === "members" || visibilityRaw === "subscription" ?
      "private" :
      visibilityRaw;

  if (status !== "published") {
    throw Object.assign(new Error("This webinar is not open for purchase."), {
      status: 400,
    });
  }
  if (visibility !== "premium") {
    throw Object.assign(new Error("This webinar is not a premium session."), {
      status: 400,
    });
  }

  const alreadyUnlocked = await hasWebinarUnlock(
    input.businessId,
    input.eventId,
  );
  return {
    eventId: input.eventId,
    name: String(data.name || "").trim() || "Premium webinar",
    amount: resolvePremiumUnlockPrice(data),
    alreadyUnlocked,
  };
}
