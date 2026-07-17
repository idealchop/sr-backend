import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { SubscriptionService } from "../subscriptions/subscription-service";
import {
  trainingVideosCollection,
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  buildEmbedUrl,
  parsePlaybackProvider,
  resolveThumbnailUrl,
  type PlaybackProvider,
} from "./member-playback";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const RESOURCE_VIDEO_CATEGORIES = new Set(["webinar", "wrs_stories"]);
const VIEWABLE_VIDEO_STATUSES = new Set(["published", "archived"]);
const UPCOMING_STATUSES = new Set(["published"]);
const ARCHIVE_STATUSES = new Set(["completed", "archived", "cancelled"]);

export type RegistrationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type MemberWebinarRegistration = {
  id: string;
  eventId: string;
  status: RegistrationStatus;
  /** Optional per-registration join URL from ops. */
  joinLink?: string | null;
  /** Set when member joined or ops marked attendance. */
  attendanceStatus?: "attended" | "no_show" | null;
  attendedAt?: string | null;
};

export type MemberWebinar = {
  id: string;
  name: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  speaker: string;
  host: string;
  posterUrl: string | null;
  /** First publish / create time — drives “New” and Posted ago. */
  publishedAt: string | null;
  capacity: number | null;
  registrationCount: number;
  /** True when capacity is set and seats are filled. */
  isFull: boolean;
  /** Remaining seats when capacity is set; null = unlimited. */
  seatsRemaining: number | null;
  /** CMS: auto-accept registrations without ops review. */
  autoAccept: boolean;
  status: string;
  tags: string[];
  /** Only present when the member's registration is accepted. */
  joinLink: string | null;
  linkedVideoId: string | null;
  myRegistration: MemberWebinarRegistration | null;
  /** CMS visibility: public | premium | private (+ legacy aliases). */
  visibility: string;
  /** True when not premium, or this workspace has paid via PayMongo. */
  unlocked: boolean;
  /** PHP unlock price when premium and not yet unlocked. */
  premiumPrice: number | null;
  /**
   * True when visibility is private with a plan allow-list that this
   * workspace subscription does not satisfy — UI should offer Upgrade.
   */
  requiresUpgrade: boolean;
  /** CMS: webinar offers an attendance certificate template. */
  certificationEnabled: boolean;
  /** Idempotent certificate already claimed for this workspace. */
  certificateClaimed: boolean;
};

export type MemberTrainingVideo = {
  id: string;
  name: string;
  description: string;
  category: "webinar" | "wrs_stories";
  status: string;
  recordedAt: string | null;
  /** First publish time — used for “New” within 24h. */
  publishedAt: string | null;
  playbackProvider: PlaybackProvider;
  thumbnailUrl: string | null;
  featured: boolean;
  visibility: string;
  canWatch: boolean;
  embedUrl: string | null;
  tags: string[];
  likeCount: number;
  commentCount: number;
  questionCount: number;
  likedByMe: boolean;
  watched: boolean;
  /** PHP unlock price when visibility is premium and not yet unlocked. */
  premiumPrice: number | null;
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

function parseRegistrationStatus(raw: unknown): RegistrationStatus {
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

function mapRegistration(
  id: string,
  data: DocumentData,
): MemberWebinarRegistration {
  const joinLink =
    typeof data.joinLink === "string" && data.joinLink.trim() ?
      data.joinLink.trim() :
      null;
  const attendanceRaw = String(data.attendanceStatus ?? "");
  const attendanceStatus =
    attendanceRaw === "attended" || attendanceRaw === "no_show" ?
      attendanceRaw :
      null;
  return {
    id,
    eventId: String(data.eventId ?? ""),
    status: parseRegistrationStatus(data.status),
    joinLink,
    attendanceStatus,
    attendedAt: toIso(data.attendedAt),
  };
}

function resolveEventJoinLink(data: DocumentData): string {
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

function resolveEventVisibility(data: DocumentData): string {
  const raw = typeof data.visibility === "string" ? data.visibility : "private";
  if (raw === "members" || raw === "subscription") return "private";
  return raw;
}

function resolveEventPremiumPrice(data: DocumentData): number {
  const raw = Number(
    data.unlockPrice ?? data.pricePhp ?? data.price ?? 99,
  );
  if (!Number.isFinite(raw) || raw <= 0) return 99;
  return Math.round(raw * 100) / 100;
}

function seatsForEvent(data: DocumentData): {
  capacity: number | null;
  isFull: boolean;
  seatsRemaining: number | null;
} {
  if (data.capacity == null) {
    return { capacity: null, isFull: false, seatsRemaining: null };
  }
  const capacity = Number(data.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return { capacity: null, isFull: false, seatsRemaining: null };
  }
  const count = Number(data.registrationCount) || 0;
  const remaining = Math.max(0, capacity - count);
  return {
    capacity,
    isFull: remaining <= 0,
    seatsRemaining: remaining,
  };
}

function mapWebinar(
  id: string,
  data: DocumentData,
  myRegistration: MemberWebinarRegistration | null,
  unlockedEventIds?: Set<string>,
  memberPlanCode?: string | null,
  claimedCertificateIds?: Set<string>,
): MemberWebinar {
  // Prefer the event (Sales) join URL so CMS updates show without waiting
  // for per-registration joinLink copies to be rewritten.
  const eventJoinLink = resolveEventJoinLink(data);
  const registrationJoinLink =
    typeof myRegistration?.joinLink === "string" ?
      myRegistration.joinLink.trim() :
      "";
  const webinarJoinLink = eventJoinLink || registrationJoinLink;
  const visibility = resolveEventVisibility(data);
  const unlocked =
    visibility !== "premium" || Boolean(unlockedEventIds?.has(id));
  const revealJoin =
    unlocked &&
    myRegistration?.status === "accepted" &&
    webinarJoinLink.length > 0;
  const premiumPrice =
    visibility === "premium" && !unlocked ?
      resolveEventPremiumPrice(data) :
      null;

  let requiresUpgrade = false;
  if (visibility === "private" && data.allowAllMembers !== true) {
    const plans = Array.isArray(data.allowedPlanCodes) ?
      data.allowedPlanCodes :
      [];
    if (plans.length > 0) {
      requiresUpgrade = !memberPlanMatchesAllowed(memberPlanCode, plans);
    }
  }

  const seats = seatsForEvent(data);

  return {
    id,
    name: String(data.name ?? "").trim() || "Untitled webinar",
    description: String(data.description ?? "").trim(),
    startsAt: toIso(data.startsAt),
    endsAt: toIso(data.endsAt),
    timezone:
      typeof data.timezone === "string" && data.timezone.trim() ?
        data.timezone.trim() :
        "Asia/Manila",
    speaker: String(data.speaker ?? "").trim(),
    host: String(data.host ?? "").trim(),
    posterUrl: typeof data.posterUrl === "string" ? data.posterUrl : null,
    publishedAt:
      toIso(data.publishedAt) ?? toIso(data.createdAt) ?? toIso(data.updatedAt),
    capacity: seats.capacity,
    registrationCount: Number(data.registrationCount) || 0,
    isFull: seats.isFull,
    seatsRemaining: seats.seatsRemaining,
    autoAccept: data.autoAccept === true,
    status: String(data.status ?? "draft"),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    joinLink: revealJoin ? webinarJoinLink : null,
    linkedVideoId:
      typeof data.linkedVideoId === "string" ? data.linkedVideoId : null,
    myRegistration,
    visibility,
    unlocked,
    premiumPrice,
    requiresUpgrade,
    certificationEnabled: data.certificationEnabled === true,
    certificateClaimed: Boolean(claimedCertificateIds?.has(id)),
  };
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

function canWatchVideo(
  data: DocumentData,
  memberPlanCode?: string | null,
  unlockedVideoIds?: Set<string>,
  videoId?: string,
): boolean {
  const visibility =
    typeof data.visibility === "string" ? data.visibility : "public";
  if (visibility === "public") return true;
  // Legacy "members" or private with allowAllMembers → any signed-in workspace member.
  if (visibility === "members") return true;
  if (visibility === "private") {
    if (data.allowAllMembers === true) return true;
    const plans = Array.isArray(data.allowedPlanCodes) ?
      data.allowedPlanCodes :
      [];
    // Private with no plan gate historically meant all members.
    if (plans.length === 0) return true;
    return memberPlanMatchesAllowed(memberPlanCode, plans);
  }
  // premium → unlock via PayMongo purchase for this workspace
  if (visibility === "premium") {
    return Boolean(videoId && unlockedVideoIds?.has(videoId));
  }
  return false;
}

function mapVideo(
  doc: QueryDocumentSnapshot,
  memberPlanCode?: string | null,
  unlockedVideoIds?: Set<string>,
): MemberTrainingVideo | null {
  const data = doc.data() ?? {};
  const category = typeof data.category === "string" ? data.category : "";
  if (!RESOURCE_VIDEO_CATEGORIES.has(category)) return null;
  const status = String(data.status ?? "");
  // Include archived webinar/story recordings (not only currently "published").
  if (!VIEWABLE_VIDEO_STATUSES.has(status)) return null;

  const provider = parsePlaybackProvider(data.playbackProvider);
  const playbackUrl =
    typeof data.playbackUrl === "string" ? data.playbackUrl : "";
  const playbackId =
    typeof data.playbackId === "string" ? data.playbackId : null;
  const visibility = typeof data.visibility === "string" ? data.visibility : "public";
  const watchable = canWatchVideo(
    data,
    memberPlanCode,
    unlockedVideoIds,
    doc.id,
  );
  const embedUrl = watchable ?
    buildEmbedUrl({ provider, playbackUrl, playbackId }) :
    null;

  let premiumPrice: number | null = null;
  if (visibility === "premium" && !watchable) {
    premiumPrice = resolvePremiumUnlockPrice(data as Record<string, unknown>);
  }

  return {
    id: doc.id,
    name: String(data.name ?? "").trim() || "Untitled video",
    description: String(data.description ?? "").trim(),
    category: category as "webinar" | "wrs_stories",
    status,
    recordedAt: toIso(data.recordedAt) ?? toIso(data.publishedAt) ?? toIso(data.archivedAt),
    publishedAt:
      toIso(data.publishedAt) ?? toIso(data.createdAt) ?? toIso(data.recordedAt),
    playbackProvider: provider,
    thumbnailUrl: resolveThumbnailUrl({
      provider,
      playbackUrl,
      playbackId,
      thumbnailUrl:
        typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
    }),
    featured: data.featured === true,
    visibility,
    canWatch: watchable && !!embedUrl,
    embedUrl,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    likeCount: 0,
    commentCount: 0,
    questionCount: 0,
    likedByMe: false,
    watched: false,
    premiumPrice,
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

async function loadMyRegistrationsByEvent(
  userId: string,
  eventIds: string[],
): Promise<Map<string, MemberWebinarRegistration>> {
  const map = new Map<string, MemberWebinarRegistration>();
  if (!userId || eventIds.length === 0) return map;

  // Prefer a single user-scoped query over N event lookups.
  const snap = await webinarRegistrationsCollection()
    .where("userId", "==", userId)
    .limit(200)
    .get();

  const wanted = new Set(eventIds);
  for (const doc of snap.docs) {
    const reg = mapRegistration(doc.id, doc.data() ?? {});
    if (!wanted.has(reg.eventId)) continue;
    // Prefer non-cancelled when duplicates exist.
    const existing = map.get(reg.eventId);
    if (!existing || existing.status === "cancelled") {
      map.set(reg.eventId, reg);
    }
  }
  return map;
}

/**
 * Published upcoming webinars (or archives) for a signed-in workspace member.
 * Join links are gated to accepted registrations only.
 * Premium sessions require a PayMongo unlock grant for this workspace.
 */
export async function listMemberWebinars(input: {
  userId: string;
  businessId: string;
  archives?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<MemberWebinar>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const archives = input.archives === true;
  const q = (input.q || "").trim().toLowerCase();

  // Single-field status query — filter archives vs upcoming in memory.
  const status = archives ? "completed" : "published";
  let snap;
  try {
    snap = await webinarsCollection().where("status", "==", status).limit(100).get();
  } catch {
    snap = await webinarsCollection().limit(100).get();
  }

  let rows = snap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return { id: doc.id, data, status: String(data.status ?? "") };
  });

  if (archives) {
    // Include archived/cancelled if the primary query was completed-only.
    if (status === "completed") {
      const extra = await webinarsCollection()
        .where("status", "in", ["archived", "cancelled"])
        .limit(100)
        .get()
        .catch(() => null);
      if (extra) {
        const seen = new Set(rows.map((r) => r.id));
        for (const doc of extra.docs) {
          if (seen.has(doc.id)) continue;
          rows.push({
            id: doc.id,
            data: doc.data() ?? {},
            status: String(doc.data()?.status ?? ""),
          });
        }
      }
    }
    rows = rows.filter((r) => ARCHIVE_STATUSES.has(r.status));
  } else {
    rows = rows.filter((r) => UPCOMING_STATUSES.has(r.status));
  }

  if (q) {
    rows = rows.filter((r) => {
      const name = String(r.data.name ?? "").toLowerCase();
      const description = String(r.data.description ?? "").toLowerCase();
      const speaker = String(r.data.speaker ?? "").toLowerCase();
      return (
        name.includes(q) || description.includes(q) || speaker.includes(q)
      );
    });
  }

  rows.sort((a, b) => {
    const aStart = toIso(a.data.startsAt) ?? "";
    const bStart = toIso(b.data.startsAt) ?? "";
    return archives ?
      bStart.localeCompare(aStart) :
      aStart.localeCompare(bStart);
  });

  const registrations = await loadMyRegistrationsByEvent(
    input.userId,
    rows.map((r) => r.id),
  );

  const { listUnlockedWebinarIds } = await import(
    "./member-webinar-unlock-service"
  );
  const unlockedEventIds = await listUnlockedWebinarIds(input.businessId);

  const { listClaimedWebinarCertificateIds } = await import(
    "./member-webinar-certificate-service"
  );
  const claimedCertificateIds = await listClaimedWebinarCertificateIds(
    input.businessId,
  );

  let memberPlanCode = "starter";
  try {
    const sub = await SubscriptionService.getSubscriptionStatus(
      input.businessId,
    );
    memberPlanCode = normalizePlanCode(sub?.planCode) || "starter";
  } catch {
    memberPlanCode = "starter";
  }

  const mapped = rows.map((r) =>
    mapWebinar(
      r.id,
      r.data,
      registrations.get(r.id) ?? null,
      unlockedEventIds,
      memberPlanCode,
      claimedCertificateIds,
    ),
  );

  // History tab: only sessions this member registered for (accepted or declined).
  const filtered = archives ?
    mapped.filter((item) => {
      const status = item.myRegistration?.status;
      return status === "accepted" || status === "declined";
    }) :
    mapped;

  return paginate(filtered, page, pageSize);
}

/**
 * Published + archived webinar recordings and WRS Stories (excludes drafts/tutorials).
 * Premium stays locked until purchase; private plan gates unlock when the business
 * subscription matches `allowedPlanCodes`.
 */
export async function listMemberTrainingVideos(input: {
  businessId: string;
  userId: string;
  q?: string;
  category?: "webinar" | "wrs_stories" | "all";
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<MemberTrainingVideo>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const q = (input.q || "").trim().toLowerCase();
  const category = input.category ?? "all";

  const categories =
    category === "all" ? ["webinar", "wrs_stories"] : [category];

  let memberPlanCode = "starter";
  try {
    const sub = await SubscriptionService.getSubscriptionStatus(
      input.businessId,
    );
    memberPlanCode = normalizePlanCode(sub?.planCode) || "starter";
  } catch {
    memberPlanCode = "starter";
  }

  const { listUnlockedVideoIds } = await import("./member-video-unlock-service");
  const unlockedVideoIds = await listUnlockedVideoIds(input.businessId);

  // Query by category only, then keep published/archived in memory so archived
  // webinar recordings are not dropped (status+category composite would miss archive).
  let snap;
  try {
    snap = await trainingVideosCollection()
      .where("category", "in", categories)
      .limit(300)
      .get();
  } catch {
    // Fallback when `in` query needs an index still building.
    const batches = await Promise.all(
      categories.map((cat) =>
        trainingVideosCollection().where("category", "==", cat).limit(200).get(),
      ),
    );
    const docs = batches.flatMap((batch) => batch.docs);
    snap = { docs };
  }

  let items = snap.docs
    .map((doc) => mapVideo(doc, memberPlanCode, unlockedVideoIds))
    .filter((v): v is MemberTrainingVideo => !!v);

  if (q) {
    items = items.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q),
    );
  }

  items.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "");
  });

  const pageResult = paginate(items, page, pageSize);
  const { attachVideoListEngagement } = await import(
    "./member-engagement-service"
  );
  const enriched = await attachVideoListEngagement({
    videos: pageResult.items,
    userId: input.userId,
  });

  return {
    ...pageResult,
    items: enriched,
  };
}
