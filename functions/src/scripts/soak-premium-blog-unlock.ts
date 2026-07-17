/**
 * Seeds / refreshes a published premium WRS Blog for PayMongo unlock soak.
 *
 * Writes both CMS price fields Sales Portal uses:
 * - `priceCents` (integer centavos, source of truth)
 * - `unlockPrice` (PHP display / API fallback)
 *
 * Usage:
 *   npx ts-node src/scripts/soak-premium-blog-unlock.ts
 *   SOAK_BUSINESS_ID=<biz> SOAK_USER_ID=<uid> \\
 *     npx ts-node src/scripts/soak-premium-blog-unlock.ts --grant
 *
 * `--grant` writes an active `blog_article_unlocks` row (simulates paid webhook).
 */
import { db, FieldValue } from "../config/firebase-admin";
import { wrsBlogsCollection } from "../services/events-training/events-training-collections";
import {
  blogUnlocksCollection,
  grantBlogUnlock,
} from "../services/events-training/member-blog-unlock-service";
import { resolvePremiumUnlockPrice } from "../services/events-training/member-video-unlock-service";

const SLUG = "sr-premium-blog-soak";
/** ₱149.00 — matches Sales Portal `priceCents` integer cents. */
const PRICE_CENTS = 14900;
const BODY_HTML = `
<p class="lead">This is the Smart Refill premium blog soak article.</p>
<p>If you can read this full body after PayMongo (or mock) unlock, <strong>priceCents → unlock → grant</strong> works.</p>
<blockquote>Unlock amount should resolve to ₱149.00 from CMS <code>priceCents: 14900</code>.</blockquote>
<p>Written for staging soak — safe to republish or archive after verification.</p>
`.trim();

async function upsertPremiumBlog(): Promise<{
  id: string;
  slug: string;
  amount: number;
  created: boolean;
}> {
  const existing = await wrsBlogsCollection()
    .where("slug", "==", SLUG)
    .limit(1)
    .get();

  const now = FieldValue.serverTimestamp();
  const unlockPrice = Math.round((PRICE_CENTS / 100) * 100) / 100;
  const payload = {
    title: "Premium blog soak — PayMongo unlock",
    slug: SLUG,
    excerpt:
      "Staging article to verify CMS priceCents/unlockPrice and premium unlock checkout.",
    body: BODY_HTML,
    authorName: "Smart Refill Soak",
    heroImageUrl: null,
    status: "published",
    appId: "smartrefill",
    visibility: "premium",
    priceCents: PRICE_CENTS,
    unlockPrice,
    currency: "PHP",
    allowedPlanCodes: [] as string[],
    allowAllMembers: false,
    featured: true,
    tags: ["soak", "premium", "paymongo"],
    allowAnonymousComments: true,
    publishedAt: now,
    archivedAt: null,
    updatedAt: now,
  };

  if (!existing.empty) {
    const doc = existing.docs[0];
    await doc.ref.set(
      {
        ...payload,
        // Keep original publishedAt if already present.
        publishedAt: doc.data()?.publishedAt ?? now,
      },
      { merge: true },
    );
    const snap = await doc.ref.get();
    const amount = resolvePremiumUnlockPrice(
      (snap.data() || {}) as Record<string, unknown>,
    );
    return { id: doc.id, slug: SLUG, amount, created: false };
  }

  const ref = wrsBlogsCollection().doc();
  await ref.set({
    ...payload,
    createdAt: now,
    author: { uid: "soak-script", email: "", name: "Smart Refill Soak" },
    createdBy: { uid: "soak-script", email: "" },
    updatedBy: { uid: "soak-script", email: "" },
  });
  const amount = resolvePremiumUnlockPrice(payload as Record<string, unknown>);
  return { id: ref.id, slug: SLUG, amount, created: true };
}

async function verifyCatalogShape(articleId: string): Promise<void> {
  const snap = await wrsBlogsCollection().doc(articleId).get();
  if (!snap.exists) {
    throw new Error("SOAK_BLOG_MISSING");
  }
  const data = snap.data() || {};
  const cents = Number(data.priceCents);
  const unlock = Number(data.unlockPrice);
  const amount = resolvePremiumUnlockPrice(data as Record<string, unknown>);

  if (String(data.visibility) !== "premium") {
    throw new Error(`Expected visibility=premium, got ${data.visibility}`);
  }
  if (String(data.status) !== "published") {
    throw new Error(`Expected status=published, got ${data.status}`);
  }
  if (cents !== PRICE_CENTS) {
    throw new Error(`Expected priceCents=${PRICE_CENTS}, got ${cents}`);
  }
  if (unlock !== 149) {
    throw new Error(`Expected unlockPrice=149, got ${unlock}`);
  }
  if (amount !== 149) {
    throw new Error(`resolvePremiumUnlockPrice expected 149, got ${amount}`);
  }

  // Prefer priceCents over a conflicting unlockPrice.
  const preferCents = resolvePremiumUnlockPrice({
    priceCents: 19900,
    unlockPrice: 50,
  });
  if (preferCents !== 199) {
    throw new Error(`priceCents preference failed: ${preferCents}`);
  }
  const fallbackUnlock = resolvePremiumUnlockPrice({ unlockPrice: 75 });
  if (fallbackUnlock !== 75) {
    throw new Error(`unlockPrice fallback failed: ${fallbackUnlock}`);
  }
}

async function maybeGrantUnlock(articleId: string): Promise<void> {
  const grant = process.argv.includes("--grant");
  if (!grant) return;

  const businessId = String(process.env.SOAK_BUSINESS_ID || "").trim();
  const userId = String(process.env.SOAK_USER_ID || "soak-script").trim();
  if (!businessId) {
    throw new Error(
      "SOAK_BUSINESS_ID is required with --grant (workspace that will read the article).",
    );
  }

  await grantBlogUnlock({
    businessId,
    articleId,
    userId,
    intentId: `soak_pi_${Date.now()}`,
    amount: 149,
    provider: "mock",
  });

  const granted = await blogUnlocksCollection(businessId).doc(articleId).get();
  if (!granted.exists || String(granted.data()?.status) !== "active") {
    throw new Error("Grant write failed — unlock doc missing or inactive.");
  }

  console.log(
    `Granted unlock: businesses/${businessId}/blog_article_unlocks/${articleId}`,
  );
}

async function main(): Promise<void> {
  // Touch db so admin init runs before any writes.
  void db;

  const blog = await upsertPremiumBlog();
  await verifyCatalogShape(blog.id);
  await maybeGrantUnlock(blog.id);

  const appBase =
    process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const publicUrl = `${appBase}/resources/blogs?article=${encodeURIComponent(blog.slug)}`;
  const hubUrl = `${appBase}/webinars?tab=blogs&article=${encodeURIComponent(blog.slug)}`;

  console.log("");
  console.log("Premium blog soak — ready");
  console.log(`  articleId: ${blog.id}`);
  console.log(`  slug:      ${blog.slug}`);
  console.log(`  amount:    ₱${blog.amount.toFixed(2)} (from priceCents ${PRICE_CENTS})`);
  console.log(`  action:    ${blog.created ? "created" : "updated"}`);
  console.log(`  public:    ${publicUrl}`);
  console.log(`  hub:       ${hubUrl}`);
  console.log("");
  console.log("Next (mock checkout when PAYMONGO not configured / SMARTREFILL_ENV_DEV):");
  console.log("  1. Sign in as a station owner (onboarding complete).");
  console.log("  2. Open hub URL → Pay ₱149 · PayMongo → complete mock checkout.");
  console.log("  3. Confirm businesses/{biz}/blog_article_unlocks/{articleId} status=active.");
  console.log("  4. Re-open article — full body + like/comment available.");
  console.log("");
  console.log("Live PayMongo (staging functions with PAYMONGO_SECRET_KEY):");
  console.log("  Same UI path; checkout opens PayMongo link; webhook grants unlock.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
