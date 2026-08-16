import { createHash, randomUUID } from "crypto";
import { db, FieldValue } from "../../config/firebase-admin";
import {
  maskProfanityLocal,
  maskVideoEngagementProfanity,
} from "../team/team-chat-profanity-filter";
import {
  EVENTS_TRAINING_COLLECTIONS,
  eventsTrainingRoot,
  webinarsCollection,
} from "./events-training-collections";

export type PublicWebinarEventComment = {
  id: string;
  text: string;
  displayName: string | null;
  authorType: "anonymous" | "member" | "staff";
  parentId: string | null;
  createdAt: string | null;
  answer: string | null;
  answeredAt: string | null;
};

export type PaginatedWebinarEventComments = {
  items: PublicWebinarEventComment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const MAX_BODY = 1000;
const MAX_DISPLAY_NAME = 80;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const ANONYMOUS_LABEL = "Anonymous";
const GUEST_PREFIX = "guest:";

function engagementDoc(eventId: string) {
  return eventsTrainingRoot()
    .collection(EVENTS_TRAINING_COLLECTIONS.webinarEventEngagement)
    .doc(eventId);
}

function likesCol(eventId: string) {
  return engagementDoc(eventId).collection("likes");
}

function postsCol(eventId: string) {
  return engagementDoc(eventId).collection("posts");
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

function clampPageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

function clampPage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function normalizeWebinarEventId(raw: string): string {
  return String(raw || "").trim();
}

export async function assertPublicWebinarEvent(eventId: string): Promise<string> {
  const id = normalizeWebinarEventId(eventId);
  if (!id) {
    throw Object.assign(new Error("Webinar not found."), { status: 404 });
  }
  const snap = await webinarsCollection().doc(id).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Webinar not found."), { status: 404 });
  }
  const status = String(snap.data()?.status ?? "draft");
  if (status === "draft" || status === "cancelled") {
    throw Object.assign(new Error("Webinar not found."), { status: 404 });
  }
  return id;
}

export function resolveGuestLikeId(raw: unknown, fallbackSeed?: string): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  if (cleaned.length >= 8) return `${GUEST_PREFIX}${cleaned}`;
  const seed = String(fallbackSeed || randomUUID());
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `${GUEST_PREFIX}${hash}`;
}

function mapPublicComment(
  id: string,
  data: Record<string, unknown>,
): PublicWebinarEventComment | null {
  if (data.kind && data.kind !== "comment") return null;
  if (data.status === "hidden" || data.status === "flagged") return null;
  const text = String(data.body ?? data.text ?? "").trim();
  if (!text) return null;
  const anonymous = data.anonymous !== false;
  const authorTypeRaw = String(data.authorType || "");
  const authorType: PublicWebinarEventComment["authorType"] =
    authorTypeRaw === "staff" ?
      "staff" :
      authorTypeRaw === "member" ?
        "member" :
        "anonymous";
  const answer =
    typeof data.answer === "string" && data.answer.trim() ?
      maskProfanityLocal(data.answer.trim()) :
      null;
  return {
    id,
    text: maskProfanityLocal(text),
    displayName: anonymous ?
      (String(data.displayName || "").trim() || ANONYMOUS_LABEL) :
      String(data.displayName || "Station member").trim() || "Station member",
    authorType,
    parentId:
      typeof data.parentId === "string" && data.parentId.trim() ?
        data.parentId.trim() :
        null,
    createdAt: toIso(data.createdAt),
    answer,
    answeredAt: toIso(data.answeredAt),
  };
}

export async function getPublicWebinarEventEngagementSummary(
  eventId: string,
): Promise<{ eventId: string; likeCount: number; commentCount: number }> {
  const id = await assertPublicWebinarEvent(eventId);
  const snap = await engagementDoc(id).get();
  const data = snap.data() || {};
  return {
    eventId: id,
    likeCount: Number(data.likeCount || 0),
    commentCount: Number(data.commentCount || 0),
  };
}

export async function listPublicWebinarEventComments(input: {
  eventId: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedWebinarEventComments> {
  const eventId = await assertPublicWebinarEvent(input.eventId);
  const pageSize = clampPageSize(input.pageSize);
  const page = clampPage(input.page);

  let mapped: PublicWebinarEventComment[] = [];
  try {
    const snap = await postsCol(eventId)
      .where("kind", "==", "comment")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    mapped = snap.docs
      .map((doc) =>
        mapPublicComment(doc.id, (doc.data() || {}) as Record<string, unknown>),
      )
      .filter((item): item is PublicWebinarEventComment => Boolean(item));
  } catch {
    const snap = await postsCol(eventId).orderBy("createdAt", "desc").limit(300).get();
    mapped = snap.docs
      .map((doc) =>
        mapPublicComment(doc.id, (doc.data() || {}) as Record<string, unknown>),
      )
      .filter((item): item is PublicWebinarEventComment => Boolean(item));
  }

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: mapped.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export async function createPublicWebinarEventComment(input: {
  eventId: string;
  text: string;
  displayName?: string;
}): Promise<PublicWebinarEventComment> {
  const eventId = await assertPublicWebinarEvent(input.eventId);
  const trimmed = String(input.text || "").trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) {
    throw Object.assign(new Error("Please write a bit more."), { status: 400 });
  }
  if (trimmed.length > MAX_BODY) {
    throw Object.assign(new Error(`Keep it under ${MAX_BODY} characters.`), {
      status: 400,
    });
  }

  const body = await maskVideoEngagementProfanity(trimmed);
  if (body.trim().length < 2) {
    throw Object.assign(new Error("Please rewrite without foul language."), {
      status: 400,
    });
  }

  const rawName = String(input.displayName || "").trim().slice(0, MAX_DISPLAY_NAME);
  const displayName = rawName || ANONYMOUS_LABEL;
  const postRef = postsCol(eventId).doc();
  const summaryRef = engagementDoc(eventId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const summarySnap = await tx.get(summaryRef);
    const data = summarySnap.data() || {};
    tx.set(postRef, {
      kind: "comment",
      body,
      text: body,
      userId: null,
      businessId: null,
      displayName,
      anonymous: true,
      authorType: "anonymous",
      parentId: null,
      status: "visible",
      answer: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(
      summaryRef,
      {
        eventId,
        likeCount: Number(data.likeCount || 0),
        commentCount: Number(data.commentCount || 0) + 1,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    id: postRef.id,
    text: body,
    displayName,
    authorType: "anonymous",
    parentId: null,
    createdAt: new Date().toISOString(),
    answer: null,
    answeredAt: null,
  };
}

export async function setPublicWebinarEventLike(input: {
  eventId: string;
  guestId: string;
  liked: boolean;
}): Promise<{ eventId: string; likeCount: number; likedByMe: boolean }> {
  const eventId = await assertPublicWebinarEvent(input.eventId);
  const likeId = resolveGuestLikeId(input.guestId);
  const likeRef = likesCol(eventId).doc(likeId);
  const summaryRef = engagementDoc(eventId);

  return db.runTransaction(async (tx) => {
    const likeSnap = await tx.get(likeRef);
    const summarySnap = await tx.get(summaryRef);
    const current = Number(summarySnap.data()?.likeCount || 0);
    const now = FieldValue.serverTimestamp();
    const exists = likeSnap.exists;

    if (input.liked) {
      if (!exists) {
        tx.set(likeRef, {
          guestId: likeId,
          createdAt: now,
        });
        const next = current + 1;
        tx.set(
          summaryRef,
          {
            eventId,
            likeCount: next,
            commentCount: Number(summarySnap.data()?.commentCount || 0),
            updatedAt: now,
          },
          { merge: true },
        );
        return { eventId, likeCount: next, likedByMe: true };
      }
      return { eventId, likeCount: current, likedByMe: true };
    }

    if (exists) {
      tx.delete(likeRef);
      const next = Math.max(0, current - 1);
      tx.set(
        summaryRef,
        {
          eventId,
          likeCount: next,
          commentCount: Number(summarySnap.data()?.commentCount || 0),
          updatedAt: now,
        },
        { merge: true },
      );
      return { eventId, likeCount: next, likedByMe: false };
    }
    return { eventId, likeCount: current, likedByMe: false };
  });
}

/** Attach like/comment counts for a page of public webinar events. */
export async function attachWebinarEventListEngagement<
  T extends { id: string; likeCount?: number | null; commentCount?: number | null },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const snaps = await Promise.all(
    items.map((item) => engagementDoc(item.id).get()),
  );
  return items.map((item, index) => {
    const data = snaps[index]?.data() || {};
    return {
      ...item,
      likeCount: Number(data.likeCount || 0),
      commentCount: Number(data.commentCount || 0),
    };
  });
}
