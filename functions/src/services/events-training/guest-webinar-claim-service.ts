import { FieldValue } from "firebase-admin/firestore";
import {
  webinarRegistrationsCollection,
} from "./events-training-collections";
import {
  guestRegistrationDocId,
  isValidGuestEmail,
  normalizeGuestEmail,
  type GuestRegistrationStatus,
} from "./guest-webinar-registration-service";

export type ClaimGuestResult = {
  registrationId: string;
  eventId: string;
  status: GuestRegistrationStatus;
  attendanceStatus: "attended" | "no_show" | null;
  alreadyClaimed: boolean;
  claimed: boolean;
};

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

function parseAttendance(
  raw: unknown,
): "attended" | "no_show" | null {
  if (raw === "attended" || raw === "no_show") return raw;
  return null;
}

/**
 * Links a guest webinar registration to a SmartRefill member workspace.
 * Matches by eventId + auth email (deterministic guest doc id).
 */
export async function claimGuestWebinarRegistration(input: {
  eventId: string;
  userId: string;
  businessId: string;
  email: string;
}): Promise<ClaimGuestResult> {
  const eventId = String(input.eventId || "").trim();
  const userId = String(input.userId || "").trim();
  const businessId = String(input.businessId || "").trim();
  const email = normalizeGuestEmail(input.email);

  if (!eventId) {
    throw Object.assign(new Error("eventId is required."), {
      status: 400,
      code: "EVENT_ID_REQUIRED",
    });
  }
  if (!userId) {
    throw Object.assign(new Error("userId is required."), {
      status: 401,
      code: "UNAUTHORIZED",
    });
  }
  if (!businessId) {
    throw Object.assign(new Error("businessId is required."), {
      status: 400,
      code: "BUSINESS_ID_REQUIRED",
    });
  }
  if (!isValidGuestEmail(email)) {
    throw Object.assign(
      new Error("A verified account email is required to claim this registration."),
      { status: 400, code: "INVALID_EMAIL" },
    );
  }

  const registrationId = guestRegistrationDocId(eventId, email);
  const ref = webinarRegistrationsCollection().doc(registrationId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw Object.assign(
      new Error(
        "No guest registration found for this webinar and email. Register on the public webinars page first, or use the same email.",
      ),
      { status: 404, code: "GUEST_REGISTRATION_NOT_FOUND" },
    );
  }

  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const kind = String(data.kind || "member");
  const status = parseStatus(data.status);
  const attendanceStatus = parseAttendance(data.attendanceStatus);
  const existingUserId =
    typeof data.userId === "string" && data.userId.trim() ?
      data.userId.trim() :
      null;
  const existingBusinessId =
    typeof data.businessId === "string" && data.businessId.trim() ?
      data.businessId.trim() :
      null;

  if (kind !== "guest" && existingUserId && existingUserId !== userId) {
    throw Object.assign(
      new Error("This registration is already linked to another account."),
      { status: 409, code: "ALREADY_CLAIMED_OTHER" },
    );
  }

  if (
    existingUserId === userId &&
    existingBusinessId === businessId &&
    (kind === "member" || data.claimedAt)
  ) {
    return {
      registrationId,
      eventId,
      status,
      attendanceStatus,
      alreadyClaimed: true,
      claimed: false,
    };
  }

  if (existingUserId && existingUserId !== userId) {
    throw Object.assign(
      new Error("This registration is already linked to another account."),
      { status: 409, code: "ALREADY_CLAIMED_OTHER" },
    );
  }

  const now = FieldValue.serverTimestamp();
  await ref.set(
    {
      kind: "member",
      userId,
      businessId,
      email,
      claimedAt: now,
      claimedUserId: userId,
      claimedBusinessId: businessId,
      updatedAt: now,
    },
    { merge: true },
  );

  // Copy paid guest unlock into member workspace unlocks when present.
  try {
    const { hasGuestWebinarUnlock } = await import("./guest-webinar-unlock-service");
    if (await hasGuestWebinarUnlock(eventId, email)) {
      const { grantWebinarUnlock } = await import("./member-webinar-unlock-service");
      await grantWebinarUnlock({
        businessId,
        eventId,
        userId,
        intentId: `guest_claim_${registrationId}`,
        amount: 0,
        provider: "guest_claim",
      });
    }
  } catch {
    // Claim succeeded; unlock copy is best-effort.
  }

  return {
    registrationId,
    eventId,
    status,
    attendanceStatus,
    alreadyClaimed: false,
    claimed: true,
  };
}

/**
 * Claims every active guest registration for the auth email (capped).
 * Used when deep link has claimGuest=1 without a specific eventId.
 */
export async function claimAllGuestWebinarRegistrationsForEmail(input: {
  userId: string;
  businessId: string;
  email: string;
  limit?: number;
}): Promise<{ claimed: ClaimGuestResult[]; scanned: number }> {
  const email = normalizeGuestEmail(input.email);
  if (!isValidGuestEmail(email)) {
    throw Object.assign(
      new Error("A verified account email is required to claim registrations."),
      { status: 400, code: "INVALID_EMAIL" },
    );
  }

  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 40);
  const snap = await webinarRegistrationsCollection()
    .where("email", "==", email)
    .limit(limit)
    .get();

  const claimed: ClaimGuestResult[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    if (String(data.kind || "") !== "guest") continue;
    const eventId = String(data.eventId || "").trim();
    if (!eventId) continue;
    const status = parseStatus(data.status);
    if (status === "cancelled" || status === "declined") continue;
    try {
      const result = await claimGuestWebinarRegistration({
        eventId,
        userId: input.userId,
        businessId: input.businessId,
        email,
      });
      claimed.push(result);
    } catch {
      // Skip conflicts / missing; continue batch.
    }
  }

  return { claimed, scanned: snap.size };
}
