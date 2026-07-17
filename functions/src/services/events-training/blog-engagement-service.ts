import { db, FieldValue } from "../../config/firebase-admin";
import {
  maskProfanityLocal,
  maskVideoEngagementProfanity,
} from "../team/team-chat-profanity-filter";
import {
  eventsTrainingRoot,
  EVENTS_TRAINING_COLLECTIONS,
} from "./events-training-collections";
import { resolvePublishedBlogId } from "./public-blogs-service";

export type BlogEngagementPost = {
  id: string;
  kind: "comment";
  body: string;
  userId: string;
  businessId: string;
  displayName: string;
  anonymous: boolean;
  createdAt: string | null;
};

export type BlogEngagementSummary = {
  articleId: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
};

export type BlogPaginatedPosts = {
  items: BlogEngagementPost[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const MAX_BODY = 1000;
const DEFAULT_POST_PAGE_SIZE = 5;
const MAX_POST_PAGE_SIZE = 20;
const ANONYMOUS_LABEL = "Anonymous";

function engagementDoc(articleId: string) {
  return eventsTrainingRoot()
    .collection(EVENTS_TRAINING_COLLECTIONS.blogEngagement)
    .doc(articleId);
}

function likesCol(articleId: string) {
  return engagementDoc(articleId).collection("likes");
}

function postsCol(articleId: string) {
  return engagementDoc(articleId).collection("posts");
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
  const name = String(data.displayName || data.name || data.email || "").trim();
  return name || "Station member";
}

export function normalizeBlogArticleId(raw: string): string {
  return String(raw || "").trim();
}

export async function assertPublishedBlogArticle(articleId: string): Promise<string> {
  const id = await resolvePublishedBlogId(normalizeBlogArticleId(articleId));
  if (!id) {
    throw Object.assign(new Error("Article not found."), { status: 404 });
  }
  return id;
}

function mapPost(
  id: string,
  data: Record<string, unknown>,
  viewerUserId?: string,
): BlogEngagementPost | null {
  if (data.kind !== "comment") return null;
  if (data.status === "hidden") return null;
  const body = String(data.body || "").trim();
  if (!body) return null;
  const anonymous = data.anonymous === true;
  const authorId = String(data.userId || "");
  const hideIdentity = anonymous && authorId !== viewerUserId;
  return {
    id,
    kind: "comment",
    body: maskProfanityLocal(body),
    userId: hideIdentity ? "" : authorId,
    businessId: hideIdentity ? "" : String(data.businessId || ""),
    displayName: anonymous ?
      ANONYMOUS_LABEL :
      String(data.displayName || "Station member").trim() || "Station member",
    anonymous,
    createdAt: toIso(data.createdAt),
  };
}

/** Public counts for catalog cards (no auth). */
export async function getPublicBlogEngagementSummary(articleId: string): Promise<{
  articleId: string;
  likeCount: number;
  commentCount: number;
}> {
  const id = await assertPublishedBlogArticle(articleId);
  const snap = await engagementDoc(id).get();
  const data = snap.data() || {};
  return {
    articleId: id,
    likeCount: Number(data.likeCount || 0),
    commentCount: Number(data.commentCount || 0),
  };
}

export async function getBlogEngagement(input: {
  articleId: string;
  userId: string;
}): Promise<BlogEngagementSummary> {
  const articleId = await assertPublishedBlogArticle(input.articleId);
  const [summarySnap, likeSnap] = await Promise.all([
    engagementDoc(articleId).get(),
    likesCol(articleId).doc(input.userId).get(),
  ]);
  const summary = summarySnap.data() || {};
  return {
    articleId,
    likeCount: Number(summary.likeCount || 0),
    commentCount: Number(summary.commentCount || 0),
    likedByMe: likeSnap.exists,
  };
}

export async function listBlogPosts(input: {
  articleId: string;
  userId: string;
  page?: number;
  pageSize?: number;
}): Promise<BlogPaginatedPosts> {
  const articleId = await assertPublishedBlogArticle(input.articleId);
  const pageSize = Math.min(
    MAX_POST_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input.pageSize) || DEFAULT_POST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(Number(input.page) || 1));

  let mapped: BlogEngagementPost[] = [];
  try {
    const snap = await postsCol(articleId)
      .where("kind", "==", "comment")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    mapped = snap.docs
      .map((doc) =>
        mapPost(doc.id, (doc.data() || {}) as Record<string, unknown>, input.userId),
      )
      .filter((p): p is BlogEngagementPost => Boolean(p));
  } catch {
    const snap = await postsCol(articleId).orderBy("createdAt", "desc").limit(300).get();
    mapped = snap.docs
      .map((doc) =>
        mapPost(doc.id, (doc.data() || {}) as Record<string, unknown>, input.userId),
      )
      .filter((p): p is BlogEngagementPost => Boolean(p));
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

export async function toggleBlogLike(input: {
  articleId: string;
  userId: string;
  businessId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  const articleId = await assertPublishedBlogArticle(input.articleId);
  const likeRef = likesCol(articleId).doc(input.userId);
  const summaryRef = engagementDoc(articleId);

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
        { likeCount: next, updatedAt: now, articleId },
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
        updatedAt: now,
        articleId,
      },
      { merge: true },
    );
    return { liked: true, likeCount: next };
  });
}

export async function createBlogComment(input: {
  articleId: string;
  userId: string;
  businessId: string;
  body: string;
  anonymous?: boolean;
}): Promise<BlogEngagementPost> {
  const articleId = await assertPublishedBlogArticle(input.articleId);
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
  const postRef = postsCol(articleId).doc();
  const summaryRef = engagementDoc(articleId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const summarySnap = await tx.get(summaryRef);
    const data = summarySnap.data() || {};
    tx.set(postRef, {
      kind: "comment",
      body,
      userId: input.userId,
      businessId: input.businessId,
      displayName: realName,
      anonymous,
      status: "visible",
      createdAt: now,
      updatedAt: now,
    });
    tx.set(
      summaryRef,
      {
        articleId,
        likeCount: Number(data.likeCount || 0),
        commentCount: Number(data.commentCount || 0) + 1,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    id: postRef.id,
    kind: "comment",
    body,
    userId: input.userId,
    businessId: input.businessId,
    displayName,
    anonymous,
    createdAt: new Date().toISOString(),
  };
}

/** Attach public like / comment counts to a page of CMS articles. */
export async function attachBlogListEngagement<
  T extends { id: string; likeCount?: number; commentCount?: number },
>(articles: T[]): Promise<Array<T & { likeCount: number; commentCount: number }>> {
  if (articles.length === 0) return [];
  return Promise.all(
    articles.map(async (article) => {
      try {
        const snap = await engagementDoc(article.id).get();
        const data = snap.data() || {};
        return {
          ...article,
          likeCount: Number(data.likeCount || 0),
          commentCount: Number(data.commentCount || 0),
        };
      } catch {
        return { ...article, likeCount: 0, commentCount: 0 };
      }
    }),
  );
}
