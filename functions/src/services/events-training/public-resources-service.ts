import type { DocumentData } from "firebase-admin/firestore";
import { trainingVideosCollection } from "./events-training-collections";
import {
  buildEmbedUrl,
  parsePlaybackProvider,
  resolveThumbnailUrl,
  type PlaybackProvider,
} from "./member-playback";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";

const DEFAULT_PAGE_SIZE = 6;
const MAX_PAGE_SIZE = 24;

export type PublicResourceVideoVisibility = "public" | "private" | "premium" | string;

export type PublicResourceVideo = {
  id: string;
  name: string;
  description: string;
  category: "webinar" | "wrs_stories";
  recordedAt: string | null;
  /** First publish time — used for “New” within 24h. */
  publishedAt: string | null;
  playbackProvider: PlaybackProvider;
  thumbnailUrl: string | null;
  featured: boolean;
  visibility: PublicResourceVideoVisibility;
  /** True only for public published videos with a playable embed. */
  canWatch: boolean;
  /** Null when locked (private / premium) — never expose embeds for gated content. */
  embedUrl: string | null;
  /** PHP unlock price when visibility is premium. */
  premiumPrice: number | null;
  /**
   * Marketing CTA hint for locked cards:
   * - `pay` → premium PayMongo unlock (sign-in required)
   * - `register` → private / members tier (sign-in or register)
   * - null → freely watchable
   */
  unlockAction: "pay" | "register" | null;
  tags: string[];
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
  if (raw === "members") return "private";
  return raw;
}

function mapPublicVideo(
  id: string,
  data: DocumentData,
  expectedCategory: "webinar" | "wrs_stories",
  options?: { allowArchived?: boolean },
): PublicResourceVideo | null {
  const status = String(data.status ?? "");
  const statusOk =
    status === "published" ||
    (options?.allowArchived === true && status === "archived");
  if (!statusOk) return null;
  if (String(data.category ?? "") !== expectedCategory) return null;

  const visibility = normalizeVisibility(data);
  // Marketing catalog: public playable + private/premium locked teasers.
  if (
    visibility !== "public" &&
    visibility !== "private" &&
    visibility !== "premium"
  ) {
    return null;
  }

  const provider = parsePlaybackProvider(data.playbackProvider);
  const playbackUrl =
    typeof data.playbackUrl === "string" ? data.playbackUrl : "";
  const playbackId =
    typeof data.playbackId === "string" ? data.playbackId : null;
  const thumbnailUrl = resolveThumbnailUrl({
    provider,
    playbackUrl,
    playbackId,
    thumbnailUrl:
      typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
  });

  const isPublic = visibility === "public";
  const embedUrl = isPublic ?
    buildEmbedUrl({ provider, playbackUrl, playbackId }) :
    null;
  if (isPublic && !embedUrl) return null;

  const premiumPrice =
    visibility === "premium" ?
      resolvePremiumUnlockPrice(data as Record<string, unknown>) :
      null;

  let unlockAction: "pay" | "register" | null = null;
  if (visibility === "premium") unlockAction = "pay";
  else if (visibility === "private") unlockAction = "register";

  return {
    id,
    name: String(data.name ?? "").trim() || "Untitled video",
    description: String(data.description ?? "").trim(),
    category: expectedCategory,
    recordedAt: toIso(data.recordedAt) ?? toIso(data.publishedAt),
    publishedAt:
      toIso(data.publishedAt) ?? toIso(data.createdAt) ?? toIso(data.recordedAt),
    playbackProvider: provider,
    thumbnailUrl,
    featured: data.featured === true,
    visibility,
    canWatch: Boolean(isPublic && embedUrl),
    embedUrl,
    premiumPrice,
    unlockAction,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
  };
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

/**
 * Public marketing catalog — published public videos + locked private/premium
 * teasers (no embed URLs for gated content).
 */
export async function listPublicResourceVideos(input: {
  category: "webinar" | "wrs_stories";
  page?: number;
  pageSize?: number;
  featuredOnly?: boolean;
}): Promise<PaginatedResult<PublicResourceVideo>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);

  const snap = await trainingVideosCollection()
    .where("status", "==", "published")
    .where("category", "==", input.category)
    .limit(100)
    .get();

  let items = snap.docs
    .map((doc) => mapPublicVideo(doc.id, doc.data() ?? {}, input.category))
    .filter((v): v is PublicResourceVideo => !!v);

  if (input.featuredOnly) {
    items = items.filter((v) => v.featured);
  }

  items.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    // Prefer freely watchable cards ahead of locked teasers within the same band.
    if (a.canWatch !== b.canWatch) return a.canWatch ? -1 : 1;
    return (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "");
  });

  return paginate(items, page, pageSize);
}

export async function getPublicResourceVideo(
  videoId: string,
  options?: { allowArchived?: boolean },
): Promise<PublicResourceVideo | null> {
  const id = String(videoId || "").trim();
  if (!id) return null;
  const snap = await trainingVideosCollection().doc(id).get();
  if (!snap.exists) return null;
  const category = String(snap.data()?.category ?? "");
  if (category !== "webinar" && category !== "wrs_stories") return null;
  return mapPublicVideo(
    snap.id,
    snap.data() ?? {},
    category as "webinar" | "wrs_stories",
    options,
  );
}
