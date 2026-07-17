import { db, FieldValue } from "../../config/firebase-admin";
import {
  maskProfanityLocal,
  maskVideoEngagementProfanity,
} from "../team/team-chat-profanity-filter";
import {
  eventsTrainingRoot,
  EVENTS_TRAINING_COLLECTIONS,
  trainingVideosCollection,
} from "./events-training-collections";

export type EngagementPostKind = "comment" | "question";

export type EngagementPost = {
  id: string;
  kind: EngagementPostKind;
  body: string;
  userId: string;
  businessId: string;
  displayName: string;
  anonymous: boolean;
  answer: string | null;
  createdAt: string | null;
};

export type VideoEngagementSummary = {
  videoId: string;
  likeCount: number;
  commentCount: number;
  questionCount: number;
  likedByMe: boolean;
  watched: boolean;
  watchedAt: string | null;
  /** Private note for the current member only. */
  myNote: string;
  myNoteUpdatedAt: string | null;
};

export type PaginatedPosts = {
  items: EngagementPost[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  kind: EngagementPostKind;
};

const MAX_BODY = 1000;
const MAX_NOTE = 4000;
const DEFAULT_POST_PAGE_SIZE = 5;
const MAX_POST_PAGE_SIZE = 20;

function engagementDoc(videoId: string) {
  return eventsTrainingRoot()
    .collection(EVENTS_TRAINING_COLLECTIONS.trainingVideoEngagement)
    .doc(videoId);
}

function likesCol(videoId: string) {
  return engagementDoc(videoId).collection("likes");
}

function postsCol(videoId: string) {
  return engagementDoc(videoId).collection("posts");
}

function notesCol(videoId: string) {
  return engagementDoc(videoId).collection("notes");
}

function viewsCol(videoId: string) {
  return engagementDoc(videoId).collection("views");
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

async function resolveDisplayName(userId: string): Promise<string> {
  const snap = await db.collection("users").doc(userId).get();
  if (!snap.exists) return "Station member";
  const data = snap.data() || {};
  const name =
    String(data.displayName || data.name || data.email || "").trim();
  return name || "Station member";
}

async function assertPublishedResourceVideo(videoId: string): Promise<void> {
  const snap = await trainingVideosCollection().doc(videoId).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Video not found."), { status: 404 });
  }
  const data = snap.data() || {};
  const category = String(data.category || "");
  const status = String(data.status || "");
  if (category !== "webinar" && category !== "wrs_stories") {
    throw Object.assign(new Error("Engagement is only for webinar recordings and stories."), {
      status: 400,
    });
  }
  if (status !== "published" && status !== "archived") {
    throw Object.assign(new Error("This video is not available for engagement."), {
      status: 400,
    });
  }
}

const ANONYMOUS_LABEL = "Anonymous";

function mapPost(
  id: string,
  data: Record<string, unknown>,
  viewerUserId?: string,
): EngagementPost | null {
  const kind = data.kind === "question" ? "question" : data.kind === "comment" ? "comment" : null;
  if (!kind) return null;
  if (data.status === "hidden") return null;
  const body = String(data.body || "").trim();
  if (!body) return null;
  const anonymous = data.anonymous === true;
  const authorId = String(data.userId || "");
  const hideIdentity = anonymous && authorId !== viewerUserId;
  const rawAnswer =
    typeof data.answer === "string" && data.answer.trim() ? data.answer.trim() : null;
  return {
    id,
    kind,
    // Local re-mask on read so ops/Sales Portal writes and older rows stay clean in UI.
    body: maskProfanityLocal(body),
    userId: hideIdentity ? "" : authorId,
    businessId: hideIdentity ? "" : String(data.businessId || ""),
    displayName: anonymous ?
      ANONYMOUS_LABEL :
      String(data.displayName || "Station member").trim() || "Station member",
    anonymous,
    answer: rawAnswer ? maskProfanityLocal(rawAnswer) : null,
    createdAt: toIso(data.createdAt),
  };
}

/**
 * Load likes summary + private note + watched (posts load separately via listVideoPosts).
 */
export async function getVideoEngagement(input: {
  videoId: string;
  userId: string;
}): Promise<VideoEngagementSummary> {
  await assertPublishedResourceVideo(input.videoId);

  const summaryRef = engagementDoc(input.videoId);
  const [summarySnap, likeSnap, noteSnap, viewSnap] = await Promise.all([
    summaryRef.get(),
    likesCol(input.videoId).doc(input.userId).get(),
    notesCol(input.videoId).doc(input.userId).get(),
    viewsCol(input.videoId).doc(input.userId).get(),
  ]);

  const summary = summarySnap.data() || {};
  const noteData = noteSnap.exists ? (noteSnap.data() || {}) : {};
  const viewData = viewSnap.exists ? (viewSnap.data() || {}) : {};

  return {
    videoId: input.videoId,
    likeCount: Number(summary.likeCount || 0),
    commentCount: Number(summary.commentCount || 0),
    questionCount: Number(summary.questionCount || 0),
    likedByMe: likeSnap.exists,
    watched: viewSnap.exists,
    watchedAt: toIso(viewData.watchedAt ?? viewData.createdAt),
    myNote: String(noteData.body || "").trim(),
    myNoteUpdatedAt: toIso(noteData.updatedAt),
  };
}

/**
 * Paginated comments or questions for a training video.
 */
export async function listVideoPosts(input: {
  videoId: string;
  userId: string;
  kind: EngagementPostKind;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedPosts> {
  await assertPublishedResourceVideo(input.videoId);

  const pageSize = Math.min(
    MAX_POST_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input.pageSize) || DEFAULT_POST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(Number(input.page) || 1));

  let mapped: EngagementPost[] = [];
  try {
    const snap = await postsCol(input.videoId)
      .where("kind", "==", input.kind)
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    mapped = snap.docs
      .map((doc) =>
        mapPost(doc.id, (doc.data() || {}) as Record<string, unknown>, input.userId),
      )
      .filter((p): p is EngagementPost => Boolean(p));
  } catch {
    // Fallback while composite index builds: scan recent posts and filter.
    const snap = await postsCol(input.videoId)
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    mapped = snap.docs
      .map((doc) =>
        mapPost(doc.id, (doc.data() || {}) as Record<string, unknown>, input.userId),
      )
      .filter(
        (p): p is EngagementPost =>
          p != null && (p as EngagementPost).kind === input.kind,
      );
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
    kind: input.kind,
  };
}

/**
 * Toggle like for the current member. Returns updated like state.
 */
export async function toggleVideoLike(input: {
  videoId: string;
  userId: string;
  businessId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  await assertPublishedResourceVideo(input.videoId);

  const likeRef = likesCol(input.videoId).doc(input.userId);
  const summaryRef = engagementDoc(input.videoId);

  return db.runTransaction(async (tx) => {
    const likeSnap = await tx.get(likeRef);
    const summarySnap = await tx.get(summaryRef);
    const current = Number(summarySnap.data()?.likeCount || 0);
    const now = FieldValue.serverTimestamp();

    if (likeSnap.exists) {
      tx.delete(likeRef);
      const next = Math.max(0, current - 1);
      tx.set(
        summaryRef,
        { likeCount: next, updatedAt: now, videoId: input.videoId },
        { merge: true },
      );
      return { liked: false, likeCount: next };
    }

    tx.set(likeRef, {
      userId: input.userId,
      businessId: input.businessId,
      createdAt: now,
    });
    const next = current + 1;
    tx.set(
      summaryRef,
      {
        likeCount: next,
        commentCount: Number(summarySnap.data()?.commentCount || 0),
        questionCount: Number(summarySnap.data()?.questionCount || 0),
        updatedAt: now,
        videoId: input.videoId,
      },
      { merge: true },
    );
    return { liked: true, likeCount: next };
  });
}

/**
 * Create a comment or question on a training video.
 * Body is moderated (local word list + Gemini) before persistence.
 */
export async function createVideoPost(input: {
  videoId: string;
  userId: string;
  businessId: string;
  kind: EngagementPostKind;
  body: string;
  anonymous?: boolean;
}): Promise<EngagementPost> {
  await assertPublishedResourceVideo(input.videoId);

  const trimmed = input.body.trim().replace(/\s+/g, " ");
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

  const anonymous = input.anonymous === true;
  const realName = await resolveDisplayName(input.userId);
  const displayName = anonymous ? ANONYMOUS_LABEL : realName;
  const postRef = postsCol(input.videoId).doc();
  const summaryRef = engagementDoc(input.videoId);
  const now = FieldValue.serverTimestamp();
  const countField = input.kind === "question" ? "questionCount" : "commentCount";

  await db.runTransaction(async (tx) => {
    const summarySnap = await tx.get(summaryRef);
    const data = summarySnap.data() || {};
    tx.set(postRef, {
      kind: input.kind,
      body,
      userId: input.userId,
      businessId: input.businessId,
      displayName: realName,
      anonymous,
      status: "visible",
      answer: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(
      summaryRef,
      {
        videoId: input.videoId,
        likeCount: Number(data.likeCount || 0),
        commentCount: Number(data.commentCount || 0),
        questionCount: Number(data.questionCount || 0),
        [countField]: Number(data[countField] || 0) + 1,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    id: postRef.id,
    kind: input.kind,
    body,
    userId: input.userId,
    businessId: input.businessId,
    displayName,
    anonymous,
    answer: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Ops / Sales Portal answer on a question (or note on a comment).
 * Answer text is moderated before persistence.
 */
export async function answerVideoPost(input: {
  videoId: string;
  postId: string;
  answer: string;
  answeredByUid: string;
}): Promise<EngagementPost> {
  await assertPublishedResourceVideo(input.videoId);

  const trimmed = input.answer.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1) {
    throw Object.assign(new Error("Answer is required."), { status: 400 });
  }
  if (trimmed.length > MAX_BODY) {
    throw Object.assign(new Error(`Keep answers under ${MAX_BODY} characters.`), {
      status: 400,
    });
  }

  const answer = await maskVideoEngagementProfanity(trimmed);
  const postRef = postsCol(input.videoId).doc(input.postId);
  const snap = await postRef.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Post not found."), { status: 404 });
  }

  const now = FieldValue.serverTimestamp();
  await postRef.set(
    {
      answer,
      answeredAt: now,
      answeredByUid: input.answeredByUid,
      updatedAt: now,
    },
    { merge: true },
  );

  const mapped = mapPost(postRef.id, {
    ...(snap.data() || {}),
    answer,
  });
  if (!mapped) {
    throw Object.assign(new Error("Post is not visible."), { status: 404 });
  }
  return mapped;
}

/**
 * Ops inbox: questions across webinar/story recordings (unanswered first).
 */
export async function listOpsEngagementQuestions(input: {
  unansweredOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Array<{
    videoId: string;
    videoName: string;
    postId: string;
    body: string;
    displayName: string;
    businessId: string;
    answer: string | null;
    createdAt: string | null;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const pageSize = Math.min(
    MAX_POST_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input.pageSize) || DEFAULT_POST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const unansweredOnly = input.unansweredOnly !== false;

  const videosSnap = await trainingVideosCollection()
    .where("category", "in", ["webinar", "wrs_stories"])
    .limit(80)
    .get()
    .catch(async () => {
      const [a, b] = await Promise.all([
        trainingVideosCollection().where("category", "==", "webinar").limit(40).get(),
        trainingVideosCollection()
          .where("category", "==", "wrs_stories")
          .limit(40)
          .get(),
      ]);
      return { docs: [...a.docs, ...b.docs] };
    });

  const videoNames = new Map<string, string>();
  for (const doc of videosSnap.docs) {
    videoNames.set(
      doc.id,
      String(doc.data()?.name || "").trim() || "Recording",
    );
  }

  const items: Array<{
    videoId: string;
    videoName: string;
    postId: string;
    body: string;
    displayName: string;
    businessId: string;
    answer: string | null;
    createdAt: string | null;
  }> = [];

  for (const videoId of videoNames.keys()) {
    let docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
    try {
      const snap = await postsCol(videoId)
        .where("kind", "==", "question")
        .orderBy("createdAt", "desc")
        .limit(40)
        .get();
      docs = snap.docs;
    } catch {
      const snap = await postsCol(videoId).limit(60).get();
      docs = snap.docs.filter((d) => String(d.data()?.kind) === "question");
    }
    for (const doc of docs) {
      const mapped = mapPost(doc.id, (doc.data() || {}) as Record<string, unknown>);
      if (!mapped) continue;
      if (unansweredOnly && mapped.answer) continue;
      items.push({
        videoId,
        videoName: videoNames.get(videoId) || "Recording",
        postId: mapped.id,
        body: mapped.body,
        displayName: mapped.displayName,
        businessId: mapped.businessId,
        answer: mapped.answer,
        createdAt: mapped.createdAt,
      });
    }
  }

  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

/**
 * Save (or clear) the current member's private note for a training video.
 */
export async function saveVideoNote(input: {
  videoId: string;
  userId: string;
  businessId: string;
  body: string;
}): Promise<{ body: string; updatedAt: string | null }> {
  await assertPublishedResourceVideo(input.videoId);

  const body = input.body.trim();
  if (body.length > MAX_NOTE) {
    throw Object.assign(new Error(`Keep notes under ${MAX_NOTE} characters.`), {
      status: 400,
    });
  }

  const noteRef = notesCol(input.videoId).doc(input.userId);
  const now = FieldValue.serverTimestamp();

  if (!body) {
    await noteRef.delete().catch(() => undefined);
    return { body: "", updatedAt: null };
  }

  await noteRef.set(
    {
      userId: input.userId,
      businessId: input.businessId,
      body,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true },
  );

  return { body, updatedAt: new Date().toISOString() };
}

export type VideoListEngagementFields = {
  likeCount: number;
  commentCount: number;
  questionCount: number;
  likedByMe: boolean;
  watched: boolean;
};

/**
 * Attach like / comment / Q&A counts + watched flags for a page of catalog videos.
 */
export async function attachVideoListEngagement<
  T extends {
    id: string;
    likeCount?: number;
    commentCount?: number;
    questionCount?: number;
    likedByMe?: boolean;
    watched?: boolean;
  },
>(input: {
  videos: T[];
  userId: string;
}): Promise<Array<T & VideoListEngagementFields>> {
  if (input.videos.length === 0) return [];

  const enriched = await Promise.all(
    input.videos.map(async (video) => {
      const [summarySnap, likeSnap, viewSnap] = await Promise.all([
        engagementDoc(video.id).get(),
        likesCol(video.id).doc(input.userId).get(),
        viewsCol(video.id).doc(input.userId).get(),
      ]);
      const summary = summarySnap.data() ?? {};
      return {
        ...video,
        likeCount: Number(summary.likeCount || 0),
        commentCount: Number(summary.commentCount || 0),
        questionCount: Number(summary.questionCount || 0),
        likedByMe: likeSnap.exists,
        watched: viewSnap.exists,
      };
    }),
  );

  return enriched;
}

/**
 * Mark a video as watched for the current member (idempotent).
 */
export async function markVideoWatched(input: {
  videoId: string;
  userId: string;
  businessId: string;
}): Promise<{ watched: boolean; watchedAt: string | null }> {
  await assertPublishedResourceVideo(input.videoId);

  const viewRef = viewsCol(input.videoId).doc(input.userId);
  const summaryRef = engagementDoc(input.videoId);
  const existing = await viewRef.get();
  if (existing.exists) {
    const data = existing.data() || {};
    return {
      watched: true,
      watchedAt: toIso(data.watchedAt ?? data.createdAt) ?? new Date().toISOString(),
    };
  }

  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const viewSnap = await tx.get(viewRef);
    if (viewSnap.exists) return;
    const summarySnap = await tx.get(summaryRef);
    tx.set(viewRef, {
      userId: input.userId,
      businessId: input.businessId,
      watchedAt: now,
      createdAt: now,
    });
    tx.set(
      summaryRef,
      {
        videoId: input.videoId,
        viewCount: Number(summarySnap.data()?.viewCount || 0) + 1,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return { watched: true, watchedAt: new Date().toISOString() };
}
