import { FieldValue } from "firebase-admin/firestore";
import { SubscriptionService } from "../subscriptions/subscription-service";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import type {
  MemberWebinarRegistration,
  RegistrationStatus,
} from "./member-catalog-service";

export type RegisterWebinarResult = {
  registration: MemberWebinarRegistration;
  joinLink: string | null;
};

function parseStatus(raw: unknown): RegistrationStatus {
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

function normalizePlanCode(code: unknown): string {
  return String(code ?? "").trim().toLowerCase();
}

function isGrowFamily(code: string): boolean {
  return code === "grow" || code === "pro";
}

function isScaleFamily(code: string): boolean {
  return code.includes("scale");
}

function memberPlanMatchesAllowed(
  memberPlanCode: string | null | undefined,
  allowedPlanCodes: unknown[],
): boolean {
  const member = normalizePlanCode(memberPlanCode);
  if (!member) return false;
  const allowed = allowedPlanCodes
    .map((code) => normalizePlanCode(code))
    .filter(Boolean);
  if (allowed.length === 0) return true;
  for (const code of allowed) {
    if (code === member) return true;
    if (isGrowFamily(code) && isGrowFamily(member)) return true;
    if (isScaleFamily(code) && isScaleFamily(member)) return true;
  }
  return false;
}

function resolveEventJoinLink(data: Record<string, unknown>): string {
  for (const key of [
    "joinLink",
    "meetingUrl",
    "webinarUrl",
    "zoomLink",
    "meetUrl",
  ] as const) {
    const raw = data[key];
    if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) {
      return raw.trim();
    }
  }
  return "";
}

/** Null capacity (or ≤0) = unlimited. */
export function isWebinarAtCapacity(data: Record<string, unknown>): boolean {
  if (data.capacity == null) return false;
  const capacity = Number(data.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  const count = Number(data.registrationCount) || 0;
  return count >= capacity;
}

async function assertRegistrationVisibility(input: {
  eventId: string;
  eventData: Record<string, unknown>;
  businessId: string;
}): Promise<void> {
  const visibilityRaw = String(input.eventData.visibility ?? "private");
  const visibility =
    visibilityRaw === "members" || visibilityRaw === "subscription" ?
      "private" :
      visibilityRaw;

  if (visibility === "public") return;

  if (visibility === "premium") {
    const { hasWebinarUnlock } = await import("./member-webinar-unlock-service");
    const unlocked = await hasWebinarUnlock(input.businessId, input.eventId);
    if (!unlocked) {
      throw Object.assign(
        new Error(
          "This is a premium webinar. Complete PayMongo payment to register.",
        ),
        { status: 402, code: "PREMIUM_PAYMENT_REQUIRED" },
      );
    }
    return;
  }

  if (visibility !== "private") return;

  if (input.eventData.allowAllMembers === true) return;
  const plans = Array.isArray(input.eventData.allowedPlanCodes) ?
    input.eventData.allowedPlanCodes :
    [];
  // Legacy private with no plan checklist → all members.
  if (plans.length === 0) return;

  let planCode = "starter";
  try {
    const sub = await SubscriptionService.getSubscriptionStatus(
      input.businessId,
    );
    planCode = normalizePlanCode(sub?.planCode) || "starter";
  } catch {
    planCode = "starter";
  }

  if (!memberPlanMatchesAllowed(planCode, plans)) {
    throw Object.assign(
      new Error("This webinar is limited to selected subscription plans."),
      { status: 403, code: "PLAN_REQUIRED" },
    );
  }
}

async function findExistingRegistration(
  eventId: string,
  userId: string,
): Promise<{
  id: string;
  status: RegistrationStatus;
  joinLink?: string | null;
  attendedAt?: string | null;
} | null> {
  const snap = await webinarRegistrationsCollection()
    .where("eventId", "==", eventId)
    .where("userId", "==", userId)
    .limit(5)
    .get();

  if (snap.empty) return null;

  // Prefer active (non-cancelled) rows.
  let preferred = snap.docs[0];
  for (const doc of snap.docs) {
    const status = parseStatus(doc.data()?.status);
    if (status !== "cancelled" && status !== "declined") {
      preferred = doc;
      break;
    }
  }
  const data = preferred.data() ?? {};
  return {
    id: preferred.id,
    status: parseStatus(data.status),
    joinLink:
      typeof data.joinLink === "string" && data.joinLink.trim() ?
        data.joinLink.trim() :
        null,
    attendedAt:
      data.attendedAt && typeof (data.attendedAt as {toDate?: () => Date}).toDate === "function" ?
        (data.attendedAt as {toDate: () => Date}).toDate().toISOString() :
        typeof data.attendedAt === "string" ?
          data.attendedAt :
          null,
  };
}

function revealJoinLink(
  eventData: Record<string, unknown>,
  status: RegistrationStatus,
  registrationJoinLink?: string | null,
): string | null {
  if (status !== "accepted") return null;
  const link =
    resolveEventJoinLink(eventData) ||
    (typeof registrationJoinLink === "string" ? registrationJoinLink.trim() : "");
  return link || null;
}

/**
 * Creates (or reactivates) a webinar registration.
 * Defaults to `pending`; when `autoAccept` is true and seats remain → `accepted`.
 */
export async function registerForWebinar(input: {
  eventId: string;
  userId: string;
  businessId: string;
  email?: string | null;
}): Promise<RegisterWebinarResult> {
  const eventId = input.eventId.trim();
  const userId = input.userId.trim();
  const businessId = input.businessId.trim();
  if (!eventId) throw new Error("EVENT_ID_REQUIRED");
  if (!userId) throw new Error("USER_ID_REQUIRED");
  if (!businessId) throw new Error("BUSINESS_ID_REQUIRED");

  const eventRef = webinarsCollection().doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new Error("EVENT_NOT_FOUND");

  const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
  if (String(eventData.status ?? "") !== "published") {
    throw new Error("EVENT_NOT_OPEN");
  }

  await assertRegistrationVisibility({
    eventId,
    eventData,
    businessId,
  });

  const existing = await findExistingRegistration(eventId, userId);
  if (existing && existing.status !== "cancelled" && existing.status !== "declined") {
    return {
      registration: {
        id: existing.id,
        eventId,
        status: existing.status,
        joinLink: existing.joinLink ?? null,
      },
      joinLink: revealJoinLink(eventData, existing.status, existing.joinLink),
    };
  }

  if (isWebinarAtCapacity(eventData)) {
    throw Object.assign(
      new Error("This webinar is full. Registration is closed."),
      { status: 409, code: "CAPACITY_FULL" },
    );
  }

  const autoAccept = eventData.autoAccept === true;
  const nextStatus: RegistrationStatus = autoAccept ? "accepted" : "pending";
  const now = FieldValue.serverTimestamp();

  if (existing) {
    await webinarRegistrationsCollection().doc(existing.id).set(
      {
        eventId,
        userId,
        businessId,
        email: (input.email || "").trim(),
        status: nextStatus,
        emailReminderOptIn: true,
        joinLink: null,
        updatedAt: now,
      },
      { merge: true },
    );
    await eventRef.set(
      { registrationCount: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
    return {
      registration: { id: existing.id, eventId, status: nextStatus },
      joinLink: revealJoinLink(eventData, nextStatus),
    };
  }

  const ref = webinarRegistrationsCollection().doc();
  await ref.set({
    eventId,
    userId,
    businessId,
    email: (input.email || "").trim(),
    status: nextStatus,
    emailReminderOptIn: true,
    joinLink: null,
    createdAt: now,
    updatedAt: now,
  });
  await eventRef.set(
    { registrationCount: FieldValue.increment(1), updatedAt: now },
    { merge: true },
  );

  return {
    registration: { id: ref.id, eventId, status: nextStatus },
    joinLink: revealJoinLink(eventData, nextStatus),
  };
}

/** Cancels the member's active registration for an event. */
export async function cancelWebinarRegistration(input: {
  eventId: string;
  userId: string;
  businessId: string;
}): Promise<RegisterWebinarResult> {
  const eventId = input.eventId.trim();
  const userId = input.userId.trim();
  if (!eventId) throw new Error("EVENT_ID_REQUIRED");
  if (!userId) throw new Error("USER_ID_REQUIRED");

  const existing = await findExistingRegistration(eventId, userId);
  if (!existing) throw new Error("REGISTRATION_NOT_FOUND");
  if (existing.status === "cancelled") {
    return {
      registration: { id: existing.id, eventId, status: "cancelled" },
      joinLink: null,
    };
  }
  if (existing.status === "declined") {
    throw new Error("REGISTRATION_NOT_CANCELLABLE");
  }

  const now = FieldValue.serverTimestamp();
  await webinarRegistrationsCollection().doc(existing.id).set(
    {
      status: "cancelled",
      joinLink: null,
      updatedAt: now,
    },
    { merge: true },
  );

  if (existing.status === "pending" || existing.status === "accepted") {
    await webinarsCollection()
      .doc(eventId)
      .set(
        { registrationCount: FieldValue.increment(-1), updatedAt: now },
        { merge: true },
      );
  }

  return {
    registration: { id: existing.id, eventId, status: "cancelled" },
    joinLink: null,
  };
}

/**
 * Member confirms they opened the join link → marks attendance for certificates.
 */
export async function markWebinarJoinAttendance(input: {
  eventId: string;
  userId: string;
  businessId: string;
}): Promise<{
  registrationId: string;
  status: RegistrationStatus;
  attendanceStatus: "attended";
  attendedAt: string;
}> {
  const eventId = input.eventId.trim();
  const userId = input.userId.trim();
  if (!eventId) throw new Error("EVENT_ID_REQUIRED");
  if (!userId) throw new Error("USER_ID_REQUIRED");

  const existing = await findExistingRegistration(eventId, userId);
  if (!existing) throw new Error("REGISTRATION_NOT_FOUND");
  if (existing.status !== "accepted") {
    throw Object.assign(
      new Error("Only accepted registrations can record attendance."),
      { status: 403, code: "NOT_ACCEPTED" },
    );
  }

  const now = FieldValue.serverTimestamp();
  const attendedAt = new Date().toISOString();
  await webinarRegistrationsCollection().doc(existing.id).set(
    {
      attendanceStatus: "attended",
      attendedAt: now,
      joinedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  const businessId = String(input.businessId || "").trim();
  if (businessId) {
    const { awardWebinarCertificateOnAttendance } = await import(
      "./member-webinar-certificate-service"
    );
    await awardWebinarCertificateOnAttendance({
      eventId,
      businessId,
      userId,
    });
  }

  return {
    registrationId: existing.id,
    status: existing.status,
    attendanceStatus: "attended",
    attendedAt,
  };
}

/** Ops / Sales Portal: mark or clear attendance on a registration. */
export async function opsSetWebinarAttendance(input: {
  registrationId: string;
  attendanceStatus: "attended" | "no_show" | "cleared";
  opsUid: string;
}): Promise<{
  registrationId: string;
  eventId: string;
  attendanceStatus: string | null;
}> {
  const registrationId = input.registrationId.trim();
  if (!registrationId) throw new Error("REGISTRATION_ID_REQUIRED");

  const ref = webinarRegistrationsCollection().doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Registration not found."), { status: 404 });
  }

  const data = snap.data() ?? {};
  const now = FieldValue.serverTimestamp();

  if (input.attendanceStatus === "cleared") {
    await ref.set(
      {
        attendanceStatus: null,
        attendedAt: null,
        attendanceMarkedByUid: input.opsUid,
        updatedAt: now,
      },
      { merge: true },
    );
    return {
      registrationId,
      eventId: String(data.eventId ?? ""),
      attendanceStatus: null,
    };
  }

  await ref.set(
    {
      attendanceStatus: input.attendanceStatus,
      attendedAt:
        input.attendanceStatus === "attended" ? now : null,
      attendanceMarkedByUid: input.opsUid,
      updatedAt: now,
    },
    { merge: true },
  );

  const eventId = String(data.eventId ?? "").trim();
  const businessId = String(data.businessId ?? "").trim();
  const userId = String(data.userId ?? "").trim();
  if (
    input.attendanceStatus === "attended" &&
    eventId &&
    businessId &&
    userId
  ) {
    const { awardWebinarCertificateOnAttendance } = await import(
      "./member-webinar-certificate-service"
    );
    await awardWebinarCertificateOnAttendance({
      eventId,
      businessId,
      userId,
    });
  }

  return {
    registrationId,
    eventId,
    attendanceStatus: input.attendanceStatus,
  };
}
