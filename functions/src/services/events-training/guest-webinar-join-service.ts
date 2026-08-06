import { FieldValue } from "firebase-admin/firestore";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  guestRegistrationDocId,
  hashJoinToken,
  isValidGuestEmail,
  normalizeGuestEmail,
  type GuestRegistrationStatus,
} from "./guest-webinar-registration-service";

import {
  isWebinarJoinWindowOpen,
  WEBINAR_JOIN_EARLY_MS,
} from "./webinar-registration-window";

/** @deprecated Use WEBINAR_JOIN_EARLY_MS from webinar-registration-window. */
export const GUEST_JOIN_EARLY_MS = WEBINAR_JOIN_EARLY_MS;

export type GuestJoinPreview = {
  registrationId: string;
  eventId: string;
  eventName: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  registrationStatus: GuestRegistrationStatus;
  attendanceStatus: "attended" | "no_show" | null;
  joinWindowOpen: boolean;
  canJoin: boolean;
  requiresSmartRefillForValue: boolean;
  certificationEnabled: boolean;
  hasLinkedReplay: boolean;
};

export type GuestJoinResult = GuestJoinPreview & {
  joinUrl: string;
  attendedAt: string;
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function parseTime(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
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

function normalizeVisibility(raw: unknown): string {
  const v = String(raw ?? "private");
  if (v === "members" || v === "subscription") return "private";
  return v;
}

/** Join window: [startsAt − 15m, endsAt) with default 2h duration. */
export function isGuestJoinWindowOpen(
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  return isWebinarJoinWindowOpen(startsAt, endsAt, nowMs);
}

async function loadRegistrationByToken(token: string): Promise<{
  id: string;
  data: Record<string, unknown>;
}> {
  const hash = hashJoinToken(token);
  const snap = await webinarRegistrationsCollection()
    .where("joinTokenHash", "==", hash)
    .limit(3)
    .get();
  if (snap.empty) {
    throw Object.assign(new Error("Invalid or expired join link."), {
      status: 404,
      code: "TOKEN_NOT_FOUND",
    });
  }
  const doc = snap.docs[0];
  return { id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> };
}

async function buildPreview(
  registrationId: string,
  regData: Record<string, unknown>,
  nowMs: number,
): Promise<GuestJoinPreview> {
  const eventId = String(regData.eventId || "").trim();
  if (!eventId) {
    throw Object.assign(new Error("Registration is missing event."), {
      status: 500,
      code: "EVENT_MISSING",
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
  if (normalizeVisibility(eventData.visibility) !== "public") {
    throw Object.assign(new Error("Guest join is only for public webinars."), {
      status: 403,
      code: "GUEST_NOT_ALLOWED",
    });
  }

  const startsAt = toIso(eventData.startsAt);
  const endsAt = toIso(eventData.endsAt);
  const registrationStatus = parseStatus(regData.status);
  const joinWindowOpen = isGuestJoinWindowOpen(startsAt, endsAt, nowMs);
  const certificationEnabled = eventData.certificationEnabled === true;
  const linkedVideoId =
    typeof eventData.linkedVideoId === "string" && eventData.linkedVideoId.trim() ?
      eventData.linkedVideoId.trim() :
      null;
  const hasLinkedReplay = Boolean(linkedVideoId);
  const attendanceRaw = regData.attendanceStatus;
  const attendanceStatus =
    attendanceRaw === "attended" || attendanceRaw === "no_show" ?
      attendanceRaw :
      null;

  return {
    registrationId,
    eventId,
    eventName: String(eventData.name ?? "").trim() || "Untitled webinar",
    startsAt,
    endsAt,
    timezone:
      typeof eventData.timezone === "string" && eventData.timezone.trim() ?
        eventData.timezone.trim() :
        "Asia/Manila",
    registrationStatus,
    attendanceStatus,
    joinWindowOpen,
    canJoin: registrationStatus === "accepted" && joinWindowOpen,
    requiresSmartRefillForValue: certificationEnabled || hasLinkedReplay,
    certificationEnabled,
    hasLinkedReplay,
  };
}

export async function getGuestWebinarJoinByToken(
  tokenRaw: string,
): Promise<GuestJoinPreview> {
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 16) {
    throw Object.assign(new Error("Join token is required."), {
      status: 400,
      code: "TOKEN_REQUIRED",
    });
  }
  const reg = await loadRegistrationByToken(token);
  return buildPreview(reg.id, reg.data, Date.now());
}

export async function joinGuestWebinarByToken(
  tokenRaw: string,
): Promise<GuestJoinResult> {
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 16) {
    throw Object.assign(new Error("Join token is required."), {
      status: 400,
      code: "TOKEN_REQUIRED",
    });
  }
  const reg = await loadRegistrationByToken(token);
  return completeGuestJoin(reg.id, reg.data);
}

export async function joinGuestWebinarByEmail(input: {
  eventId: string;
  email: string;
}): Promise<GuestJoinResult> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
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

  const registrationId = guestRegistrationDocId(eventId, email);
  const snap = await webinarRegistrationsCollection().doc(registrationId).get();
  if (!snap.exists) {
    throw Object.assign(
      new Error("No guest registration found for that email."),
      { status: 404, code: "REGISTRATION_NOT_FOUND" },
    );
  }
  return completeGuestJoin(
    registrationId,
    (snap.data() ?? {}) as Record<string, unknown>,
  );
}

async function completeGuestJoin(
  registrationId: string,
  regData: Record<string, unknown>,
): Promise<GuestJoinResult> {
  const nowMs = Date.now();
  const preview = await buildPreview(registrationId, regData, nowMs);

  if (preview.registrationStatus !== "accepted") {
    throw Object.assign(
      new Error(
        preview.registrationStatus === "pending" ?
          "Your registration is still pending approval." :
          "This registration cannot join the live session.",
      ),
      { status: 403, code: "NOT_ACCEPTED" },
    );
  }

  if (!preview.joinWindowOpen) {
    throw Object.assign(
      new Error("Join is only available shortly before and during the live session."),
      { status: 409, code: "JOIN_WINDOW_CLOSED" },
    );
  }

  const eventSnap = await webinarsCollection().doc(preview.eventId).get();
  const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
  const joinUrl = resolveEventJoinLink(eventData);
  if (!joinUrl) {
    throw Object.assign(
      new Error("Join link is not ready yet. Please try again shortly."),
      { status: 409, code: "JOIN_LINK_MISSING" },
    );
  }

  const now = FieldValue.serverTimestamp();
  const attendedAt = new Date().toISOString();
  await webinarRegistrationsCollection().doc(registrationId).set(
    {
      attendanceStatus: "attended",
      attendedAt: now,
      joinedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  return {
    ...preview,
    attendanceStatus: "attended",
    canJoin: true,
    joinUrl,
    attendedAt,
  };
}

/**
 * Guest cancels via invite/cancel token. Decrements capacity when leaving pending/accepted.
 */
export async function cancelGuestWebinarByToken(tokenRaw: string): Promise<{
  registrationId: string;
  eventId: string;
  eventName: string;
  status: "cancelled";
  alreadyCancelled: boolean;
}> {
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 16) {
    throw Object.assign(new Error("Cancel token is required."), {
      status: 400,
      code: "TOKEN_REQUIRED",
    });
  }

  const reg = await loadRegistrationByToken(token);
  const regData = reg.data;
  const eventId = String(regData.eventId || "").trim();
  const status = parseStatus(regData.status);

  let eventName = "Webinar";
  if (eventId) {
    const eventSnap = await webinarsCollection().doc(eventId).get();
    eventName =
      String(eventSnap.data()?.name ?? "").trim() || "Untitled webinar";
  }

  if (status === "cancelled") {
    return {
      registrationId: reg.id,
      eventId,
      eventName,
      status: "cancelled",
      alreadyCancelled: true,
    };
  }

  if (status === "declined") {
    throw Object.assign(new Error("This registration cannot be cancelled."), {
      status: 409,
      code: "NOT_CANCELLABLE",
    });
  }

  const now = FieldValue.serverTimestamp();
  await webinarRegistrationsCollection().doc(reg.id).set(
    {
      status: "cancelled",
      joinLink: null,
      updatedAt: now,
    },
    { merge: true },
  );

  if ((status === "pending" || status === "accepted") && eventId) {
    await webinarsCollection()
      .doc(eventId)
      .set(
        { registrationCount: FieldValue.increment(-1), updatedAt: now },
        { merge: true },
      );
  }

  return {
    registrationId: reg.id,
    eventId,
    eventName,
    status: "cancelled",
    alreadyCancelled: false,
  };
}
