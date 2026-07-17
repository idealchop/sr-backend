import type { DocumentData } from "firebase-admin/firestore";
import { wrsBlogsCollection } from "./events-training-collections";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 40;

export type PublicWrsBlog = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Null when locked (private / premium teaser). */
  bodyHtml: string | null;
  authorName: string;
  heroImageUrl: string | null;
  status: string;
  visibility: string;
  featured: boolean;
  publishedAt: string | null;
  tags: string[];
  canRead: boolean;
  premiumPrice: number | null;
  unlockAction: "pay" | "register" | null;
  likeCount: number;
  commentCount: number;
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

function normalizeVisibility(data: DocumentData): string {
  const raw = typeof data.visibility === "string" ? data.visibility : "public";
  if (raw === "members" || raw === "subscription") return "private";
  return raw;
}

function resolveAuthorName(data: DocumentData): string {
  if (typeof data.authorName === "string" && data.authorName.trim()) {
    return data.authorName.trim();
  }
  const author = data.author;
  if (author && typeof author === "object") {
    const record = author as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) {
      return record.name.trim();
    }
  }
  return "Smart Refill";
}

function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginatedResult<T> {
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

function mapBlog(
  id: string,
  data: DocumentData,
  options: { includeBodyWhenLocked: boolean },
): PublicWrsBlog | null {
  const status = String(data.status ?? "draft");
  if (status !== "published" && status !== "archived") return null;

  const appId =
    typeof data.appId === "string" && data.appId.trim() ?
      data.appId.trim() :
      "smartrefill";
  if (appId !== "smartrefill") return null;

  const visibility = normalizeVisibility(data);
  const isPublic = visibility === "public";
  const canRead = isPublic || options.includeBodyWhenLocked;
  const bodyHtml = String(data.body ?? "").trim();

  let unlockAction: PublicWrsBlog["unlockAction"] = null;
  let premiumPrice: number | null = null;
  if (visibility === "premium") {
    unlockAction = "pay";
    premiumPrice = resolvePremiumUnlockPrice(data as Record<string, unknown>);
  } else if (visibility === "private") {
    unlockAction = "register";
  }

  return {
    id,
    slug: String(data.slug ?? id).trim() || id,
    title: String(data.title ?? "").trim() || "Untitled article",
    excerpt: String(data.excerpt ?? "").trim(),
    bodyHtml: canRead && bodyHtml ? bodyHtml : null,
    authorName: resolveAuthorName(data),
    heroImageUrl:
      typeof data.heroImageUrl === "string" ? data.heroImageUrl : null,
    status,
    visibility,
    featured: data.featured === true,
    publishedAt:
      toIso(data.publishedAt) ?? toIso(data.createdAt) ?? toIso(data.updatedAt),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    canRead,
    premiumPrice: canRead && visibility === "premium" ? null : premiumPrice,
    unlockAction: canRead ? null : unlockAction,
    likeCount: 0,
    commentCount: 0,
  };
}

async function loadPublishedBlogDocs(): Promise<
  Array<{ id: string; data: DocumentData }>
  > {
  let snap;
  try {
    snap = await wrsBlogsCollection().where("status", "==", "published").limit(100).get();
  } catch {
    snap = await wrsBlogsCollection().limit(100).get();
  }

  const rows: Array<{ id: string; data: DocumentData }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const status = String(data.status ?? "draft");
    if (status !== "published" && status !== "archived") continue;
    rows.push({ id: doc.id, data });
  }

  // Also include archived when primary query was published-only.
  try {
    const archived = await wrsBlogsCollection()
      .where("status", "==", "archived")
      .limit(50)
      .get();
    const seen = new Set(rows.map((r) => r.id));
    for (const doc of archived.docs) {
      if (seen.has(doc.id)) continue;
      rows.push({ id: doc.id, data: doc.data() ?? {} });
    }
  } catch {
    // ignore
  }

  return rows;
}

/**
 * Marketing catalog — Sales Portal `wrs_blogs` published for Smart Refill.
 * Locked visibility returns teasers without body HTML.
 */
export async function listPublicWrsBlogs(input: {
  page?: number;
  pageSize?: number;
  featuredOnly?: boolean;
}): Promise<PaginatedResult<PublicWrsBlog>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const rows = await loadPublishedBlogDocs();

  let items = rows
    .map((row) => mapBlog(row.id, row.data, { includeBodyWhenLocked: false }))
    .filter((item): item is PublicWrsBlog => Boolean(item));

  if (input.featuredOnly) {
    items = items.filter((item) => item.featured);
  }

  items.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
  });

  return paginate(items, page, pageSize);
}

/**
 * Member hub catalog — same CMS source.
 * Members can read private bodies; premium unlocks via PayMongo grant body access.
 */
export async function listMemberWrsBlogs(input: {
  page?: number;
  pageSize?: number;
  q?: string;
  businessId?: string;
}): Promise<PaginatedResult<PublicWrsBlog>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const q = (input.q || "").trim().toLowerCase();
  const rows = await loadPublishedBlogDocs();

  const { listUnlockedBlogIds } = await import("./member-blog-unlock-service");
  const unlockedIds = input.businessId ?
    await listUnlockedBlogIds(input.businessId) :
    new Set<string>();

  let items = rows
    .map((row) => {
      const visibility = normalizeVisibility(row.data);
      const includeBody =
        visibility === "public" ||
        visibility === "private" ||
        unlockedIds.has(row.id);
      return mapBlog(row.id, row.data, { includeBodyWhenLocked: includeBody });
    })
    .filter((item): item is PublicWrsBlog => Boolean(item));

  if (q) {
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.excerpt.toLowerCase().includes(q) ||
        item.authorName.toLowerCase().includes(q),
    );
  }

  items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return paginate(items, page, pageSize);
}

export async function getWrsBlogByIdOrSlug(
  idOrSlug: string,
  options?: { memberAccess?: boolean; businessId?: string },
): Promise<PublicWrsBlog | null> {
  const key = String(idOrSlug || "").trim();
  if (!key) return null;

  let unlockedIds = new Set<string>();
  if (options?.memberAccess && options.businessId) {
    const { listUnlockedBlogIds } = await import("./member-blog-unlock-service");
    unlockedIds = await listUnlockedBlogIds(options.businessId);
  }

  const resolveInclude = (id: string, data: DocumentData): boolean => {
    const visibility = normalizeVisibility(data);
    if (visibility === "public") return true;
    if (options?.memberAccess === true) {
      return visibility === "private" || unlockedIds.has(id);
    }
    return false;
  };

  const byId = await wrsBlogsCollection().doc(key).get();
  if (byId.exists) {
    const data = byId.data() ?? {};
    return mapBlog(byId.id, data, {
      includeBodyWhenLocked: resolveInclude(byId.id, data),
    });
  }

  let snap;
  try {
    snap = await wrsBlogsCollection().where("slug", "==", key).limit(1).get();
  } catch {
    return null;
  }
  const doc = snap.docs[0];
  if (!doc) return null;
  const data = doc.data() ?? {};
  return mapBlog(doc.id, data, {
    includeBodyWhenLocked: resolveInclude(doc.id, data),
  });
}

/** Resolve published CMS blog doc id from id or slug (for engagement). */
export async function resolvePublishedBlogId(
  idOrSlug: string,
): Promise<string | null> {
  const blog = await getWrsBlogByIdOrSlug(idOrSlug, { memberAccess: true });
  if (!blog) return null;
  if (blog.status !== "published" && blog.status !== "archived") return null;
  return blog.id;
}
