import { createHash, randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import { isWebinarAtCapacity } from "./member-registration-service";
import {
  isCmsGuestRegistrationAllowed,
  normalizeWebinarVisibility,
} from "./guest-webinar-eligibility";
import { assertRegistrationOpen } from "./webinar-registration-window";

export type GuestRegistrationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type GuestRegisterResult = {
  registrationId: string;
  eventId: string;
  status: GuestRegistrationStatus;
  requiresApproval: boolean;
  /** Opaque join token — returned once for G1 email/local use; never store plaintext. */
  joinToken: string;
  alreadyRegistered: boolean;
};

export function normalizeGuestEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export function isValidGuestEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function normalizeGuestDisplayName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 120);
}

/** Deterministic doc id — unique per event + email without a composite index. */
export function guestRegistrationDocId(eventId: string, email: string): string {
  const digest = createHash("sha256")
    .update(`${eventId}\n${email}`)
    .digest("hex")
    .slice(0, 40);
  return `guest_${digest}`;
}

export function mintJoinToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashJoinToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function parseStatus(raw: unknown): GuestRegistrationStatus {
  if (
    raw === "pending" ||
    raw === "accepted" ||
    raw === "declined" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "pending";
}

/**
 * Public guest registration for visibility:public webinars only.
 * Mints a join token (hash stored) and sends Brevo invite when newly registered.
 */
export async function registerGuestForWebinar(input: {
  eventId: string;
  email: string;
  displayName?: string | null;
  emailReminderOptIn?: boolean;
}): Promise<GuestRegisterResult> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
  const displayName = normalizeGuestDisplayName(input.displayName);
  const emailReminderOptIn = input.emailReminderOptIn !== false;

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

  const eventRef = webinarsCollection().doc(eventId);
  const registrationId = guestRegistrationDocId(eventId, email);
  const regRef = webinarRegistrationsCollection().doc(registrationId);

  let eventSnapshotForEmail: Record<string, unknown> = {};

  const result = await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) {
      throw Object.assign(new Error("Webinar not found."), {
        status: 404,
        code: "EVENT_NOT_FOUND",
      });
    }

    const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
    eventSnapshotForEmail = eventData;
    if (String(eventData.status ?? "") !== "published") {
      throw Object.assign(new Error("This webinar is not open for registration."), {
        status: 409,
        code: "EVENT_NOT_OPEN",
      });
    }

    assertRegistrationOpen(eventData);

    const visibility = normalizeWebinarVisibility(eventData.visibility);
    if (visibility !== "public") {
      throw Object.assign(
        new Error(
          "Guest registration is only available for public webinars. Sign in to SmartRefill to continue.",
        ),
        { status: 403, code: "GUEST_NOT_ALLOWED" },
      );
    }

    if (!isCmsGuestRegistrationAllowed(eventData)) {
      throw Object.assign(
        new Error(
          "Guest registration is turned off for this webinar. Sign in to SmartRefill to continue.",
        ),
        { status: 403, code: "GUEST_DISABLED" },
      );
    }

    const existingSnap = await tx.get(regRef);
    if (existingSnap.exists) {
      const existing = existingSnap.data() ?? {};
      const status = parseStatus(existing.status);
      if (status !== "cancelled" && status !== "declined") {
        return {
          registrationId,
          eventId,
          status,
          requiresApproval: status === "pending",
          joinToken: "",
          alreadyRegistered: true,
        } satisfies GuestRegisterResult;
      }
    }

    if (isWebinarAtCapacity(eventData)) {
      throw Object.assign(
        new Error("This webinar is full. Registration is closed."),
        { status: 409, code: "CAPACITY_FULL" },
      );
    }

    const autoAccept = eventData.autoAccept === true;
    const nextStatus: GuestRegistrationStatus = autoAccept ?
      "accepted" :
      "pending";
    const joinToken = mintJoinToken();
    const now = FieldValue.serverTimestamp();

    tx.set(
      regRef,
      {
        kind: "guest",
        eventId,
        email,
        displayName,
        userId: null,
        businessId: null,
        status: nextStatus,
        emailReminderOptIn,
        joinLink: null,
        joinTokenHash: hashJoinToken(joinToken),
        joinTokenCreatedAt: now,
        inviteSentAt: null,
        reminderSentAt: null,
        claimedAt: null,
        claimedUserId: null,
        claimedBusinessId: null,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(
      eventRef,
      { registrationCount: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );

    return {
      registrationId,
      eventId,
      status: nextStatus,
      requiresApproval: nextStatus === "pending",
      joinToken,
      alreadyRegistered: false,
    } satisfies GuestRegisterResult;
  });

  if (!result.alreadyRegistered && result.joinToken) {
    try {
      const { sendGuestWebinarInviteEmail } = await import(
        "./guest-webinar-invite-email-service"
      );
      const startsAt =
        eventSnapshotForEmail.startsAt &&
        typeof (eventSnapshotForEmail.startsAt as { toDate?: () => Date }).toDate ===
          "function" ?
          (eventSnapshotForEmail.startsAt as { toDate: () => Date }).toDate().toISOString() :
          typeof eventSnapshotForEmail.startsAt === "string" ?
            eventSnapshotForEmail.startsAt :
            null;
      await sendGuestWebinarInviteEmail({
        registrationId: result.registrationId,
        email,
        displayName,
        eventName: String(eventSnapshotForEmail.name ?? "").trim() || "Smart Refill webinar",
        startsAt,
        timezone:
          typeof eventSnapshotForEmail.timezone === "string" ?
            eventSnapshotForEmail.timezone :
            "Asia/Manila",
        joinToken: result.joinToken,
        requiresApproval: result.requiresApproval,
      });
    } catch {
      // Registration succeeded; invite can be resent later (G3).
    }
  }

  return result;
}
