import { createHash, randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { PaymentIntentService } from "../payments/payment-intent-service";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";
import {
  eventsTrainingRoot,
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  guestRegistrationDocId,
  hashJoinToken,
  isValidGuestEmail,
  mintJoinToken,
  normalizeGuestDisplayName,
  normalizeGuestEmail,
} from "./guest-webinar-registration-service";
import {
  isCmsGuestRegistrationAllowed,
  normalizeWebinarVisibility,
} from "./guest-webinar-eligibility";
import {
  assertRegistrationOpen,
  toIsoTimestamp,
} from "./webinar-registration-window";
import { isWebinarAtCapacity } from "./member-registration-service";
import { sendGuestWebinarInviteEmail } from "./guest-webinar-invite-email-service";

/** Sentinel business for guest PayMongo intents (not a real station). */
export const GUEST_WEBINAR_PAYMENT_BUSINESS_ID = "__guest_webinars__";

export function guestWebinarUnlocksCollection() {
  return eventsTrainingRoot().collection("webinar_guest_unlocks");
}

export function guestWebinarCertificatesCollection() {
  return eventsTrainingRoot().collection("webinar_guest_certificates");
}

export function guestUnlockDocId(eventId: string, email: string): string {
  const digest = createHash("sha256")
    .update(`${eventId}\n${email}`)
    .digest("hex")
    .slice(0, 40);
  return `unlock_${digest}`;
}

export async function hasGuestWebinarUnlock(
  eventId: string,
  email: string,
): Promise<boolean> {
  const id = guestUnlockDocId(eventId, normalizeGuestEmail(email));
  const snap = await guestWebinarUnlocksCollection().doc(id).get();
  if (!snap.exists) return false;
  return String(snap.data()?.status || "active") === "active";
}

export async function grantGuestWebinarUnlock(input: {
  eventId: string;
  email: string;
  displayName?: string | null;
  intentId: string;
  amount: number;
  provider?: string;
}): Promise<{ registrationId: string; joinToken: string }> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
  const displayName =
    normalizeGuestDisplayName(input.displayName) || email.split("@")[0] || email;
  if (!eventId || !email) {
    throw Object.assign(new Error("EVENT_AND_EMAIL_REQUIRED"), { status: 400 });
  }

  const unlockId = guestUnlockDocId(eventId, email);
  const unlockRef = guestWebinarUnlocksCollection().doc(unlockId);
  const registrationId = guestRegistrationDocId(eventId, email);
  const regRef = webinarRegistrationsCollection().doc(registrationId);
  const eventRef = webinarsCollection().doc(eventId);
  const joinToken = mintJoinToken();
  const now = FieldValue.serverTimestamp();
  let eventSnapshot: Record<string, unknown> = {};
  let alreadyAccepted = false;

  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) {
      throw Object.assign(new Error("Webinar not found."), {
        status: 404,
        code: "EVENT_NOT_FOUND",
      });
    }
    eventSnapshot = (eventSnap.data() ?? {}) as Record<string, unknown>;

    const regSnap = await tx.get(regRef);
    const existingStatus = regSnap.exists ?
      String(regSnap.data()?.status || "") :
      "";
    alreadyAccepted =
      existingStatus === "accepted" || existingStatus === "pending";

    if (
      !alreadyAccepted &&
      isWebinarAtCapacity(eventSnapshot)
    ) {
      throw Object.assign(
        new Error("This webinar is full. Registration is closed."),
        { status: 409, code: "CAPACITY_FULL" },
      );
    }

    tx.set(
      unlockRef,
      {
        eventId,
        email,
        displayName,
        intentId: input.intentId,
        amount: input.amount,
        provider: input.provider || "paymongo",
        status: "active",
        accessTokenHash: hashJoinToken(joinToken),
        unlockedAt: now,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );

    tx.set(
      regRef,
      {
        kind: "guest",
        eventId,
        email,
        displayName,
        userId: null,
        businessId: null,
        status: "accepted",
        paidUnlock: true,
        emailReminderOptIn: true,
        joinLink: null,
        joinTokenHash: hashJoinToken(joinToken),
        joinTokenCreatedAt: now,
        inviteSentAt: null,
        reminderSentAt: null,
        claimedAt: null,
        claimedUserId: null,
        claimedBusinessId: null,
        updatedAt: now,
        ...(regSnap.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    );

    if (!alreadyAccepted) {
      tx.set(
        eventRef,
        { registrationCount: FieldValue.increment(1), updatedAt: now },
        { merge: true },
      );
    }
  });

  try {
    await sendGuestWebinarInviteEmail({
      registrationId,
      email,
      displayName,
      eventName: String(eventSnapshot.name ?? "").trim() || "Smart Refill webinar",
      startsAt: toIsoTimestamp(eventSnapshot.startsAt),
      timezone:
        typeof eventSnapshot.timezone === "string" && eventSnapshot.timezone.trim() ?
          eventSnapshot.timezone.trim() :
          "Asia/Manila",
      joinToken,
      requiresApproval: false,
    });
  } catch {
    // Unlock granted; invite can be resent.
  }

  return { registrationId, joinToken };
}

/**
 * Start guest PayMongo checkout for a premium webinar.
 */
export async function createGuestWebinarUnlockCheckout(input: {
  eventId: string;
  email: string;
  displayName?: string | null;
  apiBaseUrl: string;
}): Promise<{
  checkoutUrl: string;
  intentId: string;
  alreadyUnlocked: boolean;
  amount: number;
}> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
  const displayName = normalizeGuestDisplayName(input.displayName);

  if (!eventId) {
    throw Object.assign(new Error("eventId is required."), {
      status: 400,
      code: "EVENT_ID_REQUIRED",
    });
  }
  if (!isValidGuestEmail(email)) {
    throw Object.assign(new Error("A valid email address is required."), {
      status: 400,
      code: "INVALID_EMAIL",
    });
  }
  if (!displayName) {
    throw Object.assign(new Error("Name is required."), {
      status: 400,
      code: "NAME_REQUIRED",
    });
  }

  const eventSnap = await webinarsCollection().doc(eventId).get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }
  const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
  if (String(eventData.status ?? "") !== "published") {
    throw Object.assign(new Error("This webinar is not open for registration."), {
      status: 409,
      code: "EVENT_NOT_OPEN",
    });
  }
  assertRegistrationOpen(eventData);

  const visibility = normalizeWebinarVisibility(eventData.visibility);
  if (visibility !== "premium") {
    throw Object.assign(
      new Error("Guest payment is only available for premium webinars."),
      { status: 403, code: "NOT_PREMIUM" },
    );
  }
  if (!isCmsGuestRegistrationAllowed(eventData)) {
    throw Object.assign(
      new Error("Guest payment is turned off for this webinar."),
      { status: 403, code: "GUEST_DISABLED" },
    );
  }
  if (isWebinarAtCapacity(eventData)) {
    throw Object.assign(
      new Error("This webinar is full. Registration is closed."),
      { status: 409, code: "CAPACITY_FULL" },
    );
  }

  if (await hasGuestWebinarUnlock(eventId, email)) {
    return {
      checkoutUrl: "",
      intentId: "",
      alreadyUnlocked: true,
      amount: resolvePremiumUnlockPrice(eventData),
    };
  }

  const amount = resolvePremiumUnlockPrice(eventData);
  const intent = await PaymentIntentService.createResourceWebinarGuestUnlockIntent({
    businessId: GUEST_WEBINAR_PAYMENT_BUSINESS_ID,
    eventId,
    eventName: String(eventData.name ?? "").trim() || "Premium webinar",
    email,
    displayName,
    amount,
    apiBaseUrl: input.apiBaseUrl,
  });

  return {
    checkoutUrl: intent.checkoutUrl,
    intentId: intent.id,
    alreadyUnlocked: false,
    amount,
  };
}

export function mintGuestAccessToken(): string {
  return randomBytes(24).toString("hex");
}

export async function getGuestReplayAccess(input: {
  eventId: string;
  email: string;
  token?: string | null;
}): Promise<{
  allowed: boolean;
  embedUrl: string | null;
  videoName: string | null;
  reason?: string;
}> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
  if (!eventId || !email) {
    return { allowed: false, embedUrl: null, videoName: null, reason: "INVALID" };
  }

  const unlocked = await hasGuestWebinarUnlock(eventId, email);
  if (!unlocked) {
    return {
      allowed: false,
      embedUrl: null,
      videoName: null,
      reason: "NOT_UNLOCKED",
    };
  }

  const eventSnap = await webinarsCollection().doc(eventId).get();
  const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
  const linkedVideoId =
    typeof eventData.linkedVideoId === "string" ?
      eventData.linkedVideoId.trim() :
      "";
  if (!linkedVideoId) {
    return {
      allowed: false,
      embedUrl: null,
      videoName: null,
      reason: "NO_REPLAY",
    };
  }

  const { trainingVideosCollection } = await import("./events-training-collections");
  const { buildEmbedUrl, parsePlaybackProvider } = await import("./member-playback");
  const videoSnap = await trainingVideosCollection().doc(linkedVideoId).get();
  if (!videoSnap.exists) {
    return {
      allowed: false,
      embedUrl: null,
      videoName: null,
      reason: "VIDEO_MISSING",
    };
  }
  const video = videoSnap.data() ?? {};
  const provider = parsePlaybackProvider(video.playbackProvider);
  const playbackUrl =
    typeof video.playbackUrl === "string" ? video.playbackUrl.trim() : "";
  const embedUrl = buildEmbedUrl({
    provider,
    playbackUrl,
    playbackId:
      typeof video.playbackId === "string" ? video.playbackId : null,
  });

  return {
    allowed: Boolean(embedUrl),
    embedUrl,
    videoName: String(video.name || "").trim() || "Webinar replay",
  };
}
