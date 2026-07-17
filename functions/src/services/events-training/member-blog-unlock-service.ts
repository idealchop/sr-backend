import { db, FieldValue } from "../../config/firebase-admin";
import { wrsBlogsCollection } from "./events-training-collections";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";

export function blogUnlocksCollection(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("blog_article_unlocks");
}

export async function hasBlogUnlock(
  businessId: string,
  articleId: string,
): Promise<boolean> {
  if (!businessId || !articleId) return false;
  const snap = await blogUnlocksCollection(businessId).doc(articleId).get();
  if (!snap.exists) return false;
  return String(snap.data()?.status || "active") === "active";
}

export async function listUnlockedBlogIds(
  businessId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!businessId) return set;
  const snap = await blogUnlocksCollection(businessId).limit(200).get();
  for (const doc of snap.docs) {
    if (String(doc.data()?.status || "active") === "active") {
      set.add(doc.id);
    }
  }
  return set;
}

export async function grantBlogUnlock(input: {
  businessId: string;
  articleId: string;
  userId: string;
  intentId: string;
  amount: number;
  provider?: string;
}): Promise<void> {
  const ref = blogUnlocksCollection(input.businessId).doc(input.articleId);
  const now = FieldValue.serverTimestamp();
  await ref.set(
    {
      articleId: input.articleId,
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
 * Validate premium WRS Blog + resolve checkout amount for unlock.
 */
export async function preparePremiumBlogUnlock(input: {
  articleId: string;
  businessId: string;
}): Promise<{
  articleId: string;
  title: string;
  amount: number;
  alreadyUnlocked: boolean;
}> {
  const id = String(input.articleId || "").trim();
  if (!id) {
    throw Object.assign(new Error("Article not found."), { status: 404 });
  }

  let snap = await wrsBlogsCollection().doc(id).get();
  if (!snap.exists) {
    const bySlug = await wrsBlogsCollection().where("slug", "==", id).limit(1).get();
    snap = bySlug.docs[0] || snap;
  }
  if (!snap.exists) {
    throw Object.assign(new Error("Article not found."), { status: 404 });
  }

  const data = (snap.data() || {}) as Record<string, unknown>;
  const status = String(data.status || "");
  const visibility = String(data.visibility || "public");
  if (status !== "published" && status !== "archived") {
    throw Object.assign(new Error("This article is not available."), {
      status: 400,
    });
  }
  if (visibility !== "premium") {
    throw Object.assign(new Error("This article is not a premium post."), {
      status: 400,
    });
  }

  const articleId = snap.id;
  const alreadyUnlocked = await hasBlogUnlock(input.businessId, articleId);
  return {
    articleId,
    title: String(data.title || "").trim() || "Premium article",
    amount: resolvePremiumUnlockPrice(data),
    alreadyUnlocked,
  };
}
