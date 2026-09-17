import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  EVENTS_TRAINING_COLLECTIONS,
  eventsTrainingRoot,
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  hashJoinToken,
  isValidGuestEmail,
  normalizeGuestDisplayName,
  normalizeGuestEmail,
} from "./guest-webinar-registration-service";

export type WebinarFeedbackSubmitInput = {
  token?: unknown;
  eventId?: unknown;
  email?: unknown;
  displayName?: unknown;
  rating?: unknown;
  feedback?: unknown;
  recommend?: unknown;
  recommendation?: unknown;
};

export type WebinarFeedbackSubmitResult = {
  feedbackId: string;
  eventId: string;
  eventName: string;
  rating: number;
  recommend: boolean;
  updated: boolean;
};

function feedbackCollection() {
  return eventsTrainingRoot().collection(
    EVENTS_TRAINING_COLLECTIONS.webinarEventFeedback,
  );
}

export function webinarFeedbackDocId(eventId: string, email: string): string {
  const digest = createHash("sha256")
    .update(`${eventId.trim()}\n${normalizeGuestEmail(email)}`)
    .digest("hex")
    .slice(0, 40);
  return `fb_${digest}`;
}

function readText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function parseRating(value: unknown): number {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw Object.assign(new Error("Choose a rating from 1 to 5."), {
      status: 400,
      code: "INVALID_RATING",
    });
  }
  return Math.round(rating);
}

function parseRecommend(value: unknown): boolean {
  if (value === true || value === "true" || value === "yes" || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === "no" || value === "0") {
    return false;
  }
  throw Object.assign(new Error("Tell us whether you would recommend this webinar."), {
    status: 400,
    code: "INVALID_RECOMMEND",
  });
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
    throw Object.assign(new Error("Invalid or expired feedback link."), {
      status: 404,
      code: "TOKEN_NOT_FOUND",
    });
  }
  return { id: snap.docs[0].id, data: snap.docs[0].data() as Record<string, unknown> };
}

/**
 * Public webinar rating + written feedback + recommendation.
 * Token from the invite email identifies the registrant; otherwise email + eventId.
 */
export async function submitWebinarFeedback(
  input: WebinarFeedbackSubmitInput,
): Promise<WebinarFeedbackSubmitResult> {
  const token = String(input.token || "").trim();
  let eventId = String(input.eventId || "").trim();
  let email = normalizeGuestEmail(input.email);
  let displayName = normalizeGuestDisplayName(input.displayName);
  let registrationId: string | null = null;

  if (token) {
    const registration = await loadRegistrationByToken(token);
    registrationId = registration.id;
    eventId = String(registration.data.eventId || "").trim() || eventId;
    email = normalizeGuestEmail(registration.data.email) || email;
    if (!displayName) {
      displayName = normalizeGuestDisplayName(registration.data.displayName);
    }
  }

  if (!eventId) {
    throw Object.assign(new Error("Missing webinar."), {
      status: 400,
      code: "EVENT_REQUIRED",
    });
  }
  if (!isValidGuestEmail(email)) {
    throw Object.assign(new Error("A valid email is required."), {
      status: 400,
      code: "EMAIL_REQUIRED",
    });
  }

  const eventSnap = await webinarsCollection().doc(eventId).get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }

  const eventName =
    String((eventSnap.data() ?? {}).name || "").trim() || "Smart Refill webinar";
  const rating = parseRating(input.rating);
  const recommend = parseRecommend(input.recommend);
  const feedback = readText(input.feedback, 2000);
  const recommendation = readText(input.recommendation, 2000);
  const feedbackId = webinarFeedbackDocId(eventId, email);
  const ref = feedbackCollection().doc(feedbackId);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();

  await ref.set(
    {
      eventId,
      eventName,
      email,
      displayName: displayName || null,
      registrationId,
      rating,
      feedback: feedback || null,
      recommend,
      recommendation: recommendation || null,
      source: token ? "webinar-email-token" : "webinar-email-event",
      status: "pending",
      createdAt: existing.exists ? existing.get("createdAt") ?? now : now,
      updatedAt: now,
    },
    { merge: true },
  );

  return {
    feedbackId,
    eventId,
    eventName,
    rating,
    recommend,
    updated: existing.exists,
  };
}

function toIso(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

export type PublicWebinarFeedbackItem = {
  id: string;
  displayName: string;
  rating: number;
  feedback: string | null;
  recommend: boolean;
  createdAt: string | null;
};

export type PublicWebinarFeedbackResult = {
  summary: {
    count: number;
    averageRating: number | null;
    recommendCount: number;
    recommendRate: number | null;
  };
  items: PublicWebinarFeedbackItem[];
};

/** Approved ratings only — shown on the public SmartRefill webinar page. */
export async function listPublicWebinarFeedback(
  eventIdRaw: string,
): Promise<PublicWebinarFeedbackResult> {
  const eventId = String(eventIdRaw || "").trim();
  if (!eventId) {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }
  const eventSnap = await webinarsCollection().doc(eventId).get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }
  const eventStatus = String((eventSnap.data() ?? {}).status ?? "draft");
  if (eventStatus === "draft" || eventStatus === "cancelled") {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }

  const snap = await feedbackCollection()
    .where("eventId", "==", eventId)
    .limit(500)
    .get();
  const items: PublicWebinarFeedbackItem[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.status !== "visible") continue;
    const rating = Number(data.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    items.push({
      id: doc.id,
      displayName: String(data.displayName || "").trim() || "Attendee",
      rating: Math.round(rating),
      feedback: String(data.feedback || "").trim() || null,
      recommend: data.recommend === true,
      createdAt: toIso(data.createdAt),
    });
  }
  items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const count = items.length;
  const ratingSum = items.reduce((sum, item) => sum + item.rating, 0);
  const recommendCount = items.filter((item) => item.recommend).length;
  return {
    summary: {
      count,
      averageRating: count ? Math.round((ratingSum / count) * 10) / 10 : null,
      recommendCount,
      recommendRate: count ? Math.round((recommendCount / count) * 1000) / 1000 : null,
    },
    items,
  };
}
