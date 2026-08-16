import type { DocumentData } from "firebase-admin/firestore";
import {
  webinarsCollection,
} from "./events-training-collections";
import {
  getPublicResourceVideo,
  type PaginatedResult,
  type PublicResourceVideo,
} from "./public-resources-service";
import { resolvePremiumUnlockPrice } from "./member-video-unlock-service";
import { isGuestJoinWindowOpen } from "./guest-webinar-join-service";
import {
  isCmsGuestRegistrationAllowed,
  normalizeWebinarVisibility,
} from "./guest-webinar-eligibility";
import { isRegistrationOpen, toIsoTimestamp } from "./webinar-registration-window";

const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 24;
const DEFAULT_WEBINAR_DURATION_MS = 2 * 60 * 60 * 1000;
const JUST_FINISHED_WINDOW_MS = 6 * 60 * 60 * 1000;

const LIVE_STATUSES = new Set(["published"]);
const ARCHIVE_STATUSES = new Set(["completed", "archived"]);

export type PublicWebinarEvent = {
  id: string;
  name: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  speaker: string;
  host: string;
  posterUrl: string | null;
  publishedAt: string | null;
  status: string;
  visibility: string;
  capacity: number | null;
  registrationCount: number;
  isFull: boolean;
  seatsRemaining: number | null;
  tags: string[];
  linkedVideoId: string | null;
  /** Linked recording teaser (Archives). Embed only when publicly watchable. */
  linkedReplay: PublicResourceVideo | null;
  /** PHP unlock price when event visibility is premium. */
  premiumPrice: number | null;
  /**
   * Marketing CTA:
   * - pay → premium PayMongo after sign-in
   * - register → private / members after sign-in
   * - null → open register (guest form when guestRegistrationEnabled)
   */
  unlockAction: "pay" | "register" | null;
  schedulePhase: "upcoming" | "ongoing" | "just_finished" | "ended" | "unknown";
  /** Public + published + seats remaining — guest form on landing (no SmartRefill auth). */
  guestRegistrationEnabled: boolean;
  certificationEnabled: boolean;
  /** True when a linked recording id exists (do not expose unlock details here). */
  hasLinkedReplay: boolean;
  /** Replay and/or certificate require SmartRefill account after attend. */
  requiresSmartRefillForValue: boolean;
  /** Guest may attempt Join (public + within early/live window). */
  joinWindowOpen: boolean;
  /** When registration becomes available (null = open on publish). */
  registrationOpensAt: string | null;
  /** Published and past registrationOpensAt (or opensAt null). */
  registrationOpen: boolean;
  /**
   * Premium guest PayMongo is allowed without SmartRefill auth when
   * visibility is premium, published, seats remain, and registration is open.
   */
  guestPayEnabled: boolean;
  likeCount: number;
  commentCount: number;
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

function parseTime(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function resolveSchedulePhase(
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number,
): PublicWebinarEvent["schedulePhase"] {
  const start = parseTime(startsAt);
  if (start == null) return "unknown";
  const end = parseTime(endsAt) ?? start + DEFAULT_WEBINAR_DURATION_MS;
  if (nowMs < start) return "upcoming";
  if (nowMs >= start && nowMs < end) return "ongoing";
  if (nowMs >= end && nowMs - end <= JUST_FINISHED_WINDOW_MS) {
    return "just_finished";
  }
  return "ended";
}

function normalizeVisibility(data: DocumentData): string {
  return normalizeWebinarVisibility(data.visibility);
}

function seatsForEvent(data: DocumentData): {
  capacity: number | null;
  isFull: boolean;
  seatsRemaining: number | null;
} {
  if (data.capacity == null || data.capacity === "") {
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

function mapPublicEvent(
  id: string,
  data: DocumentData,
  nowMs: number,
  linkedReplay: PublicResourceVideo | null,
): PublicWebinarEvent | null {
  const status = String(data.status ?? "draft");
  if (status === "draft" || status === "cancelled") return null;

  const startsAt = toIso(data.startsAt);
  const endsAt = toIso(data.endsAt);
  const schedulePhase = resolveSchedulePhase(startsAt, endsAt, nowMs);
  const visibility = normalizeVisibility(data);
  const seats = seatsForEvent(data);
  const linkedVideoId =
    typeof data.linkedVideoId === "string" && data.linkedVideoId.trim() ?
      data.linkedVideoId.trim() :
      null;

  let unlockAction: PublicWebinarEvent["unlockAction"] = null;
  let premiumPrice: number | null = null;
  if (visibility === "premium") {
    unlockAction = "pay";
    premiumPrice = resolvePremiumUnlockPrice(data);
  } else if (visibility === "private") {
    unlockAction = "register";
  }

  const certificationEnabled = data.certificationEnabled === true;
  const hasLinkedReplay = Boolean(linkedVideoId);
  const registrationOpensAt = toIsoTimestamp(data.registrationOpensAt);
  const registrationOpen =
    LIVE_STATUSES.has(status) &&
    isRegistrationOpen(data as Record<string, unknown>, nowMs);
  const guestRegistrationEnabled =
    LIVE_STATUSES.has(status) &&
    visibility === "public" &&
    isCmsGuestRegistrationAllowed(data) &&
    !seats.isFull &&
    registrationOpen &&
    (schedulePhase === "upcoming" ||
      schedulePhase === "ongoing" ||
      schedulePhase === "unknown");
  const guestPayEnabled =
    LIVE_STATUSES.has(status) &&
    visibility === "premium" &&
    isCmsGuestRegistrationAllowed(data) &&
    !seats.isFull &&
    registrationOpen &&
    (schedulePhase === "upcoming" ||
      schedulePhase === "ongoing" ||
      schedulePhase === "unknown");
  const joinWindowOpen =
    LIVE_STATUSES.has(status) &&
    (visibility === "public" || visibility === "premium") &&
    isGuestJoinWindowOpen(startsAt, endsAt, nowMs);

  // Paid guests get cert/replay without SR account; free guests still convert.
  const requiresSmartRefillForValue =
    visibility !== "premium" && (certificationEnabled || hasLinkedReplay);

  return {
    id,
    name: String(data.name ?? "").trim() || "Untitled webinar",
    description: String(data.description ?? "").trim(),
    startsAt,
    endsAt,
    timezone:
      typeof data.timezone === "string" && data.timezone.trim() ?
        data.timezone.trim() :
        "Asia/Manila",
    speaker: String(data.speaker ?? "").trim(),
    host: String(data.host ?? "").trim(),
    posterUrl: typeof data.posterUrl === "string" ? data.posterUrl : null,
    publishedAt:
      toIso(data.publishedAt) ?? toIso(data.createdAt) ?? toIso(data.updatedAt),
    status,
    visibility,
    capacity: seats.capacity,
    registrationCount: Number(data.registrationCount) || 0,
    isFull: seats.isFull,
    seatsRemaining: seats.seatsRemaining,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    linkedVideoId,
    linkedReplay,
    premiumPrice,
    unlockAction,
    schedulePhase,
    guestRegistrationEnabled,
    certificationEnabled,
    hasLinkedReplay,
    requiresSmartRefillForValue,
    joinWindowOpen,
    registrationOpensAt,
    registrationOpen,
    guestPayEnabled,
    likeCount: 0,
    commentCount: 0,
  };
}

function isLatestEvent(event: PublicWebinarEvent): boolean {
  if (ARCHIVE_STATUSES.has(event.status)) return false;
  if (!LIVE_STATUSES.has(event.status) && event.status !== "published") {
    return false;
  }
  // Not yet done by schedule (or unknown schedule still listed while published).
  return (
    event.schedulePhase === "upcoming" ||
    event.schedulePhase === "ongoing" ||
    event.schedulePhase === "unknown"
  );
}

function isArchiveEvent(event: PublicWebinarEvent): boolean {
  if (ARCHIVE_STATUSES.has(event.status)) return true;
  return (
    event.schedulePhase === "just_finished" || event.schedulePhase === "ended"
  );
}

/**
 * Single published webinar event for marketing detail / SEO.
 * Returns null when missing, draft, or cancelled.
 */
export async function getPublicWebinarEventById(
  eventIdRaw: string,
): Promise<PublicWebinarEvent | null> {
  const eventId = String(eventIdRaw || "").trim();
  if (!eventId) return null;

  const snap = await webinarsCollection().doc(eventId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const status = String(data.status ?? "draft");
  if (status === "draft" || status === "cancelled") return null;

  const linkedVideoId =
    typeof data.linkedVideoId === "string" && data.linkedVideoId.trim() ?
      data.linkedVideoId.trim() :
      "";
  const linkedReplay = linkedVideoId ?
    await getPublicResourceVideo(linkedVideoId, { allowArchived: true }) :
    null;

  return mapPublicEvent(snap.id, data, Date.now(), linkedReplay);
}

/**
 * Public marketing catalog of live webinar events.
 * Latest = not yet finished by schedule; Archives = finished + linked replay teasers.
 */
export async function listPublicWebinarEvents(input: {
  archives?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<PublicWebinarEvent>> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const archives = input.archives === true;
  const nowMs = Date.now();

  let snap;
  try {
    snap = await webinarsCollection().limit(150).get();
  } catch {
    return { items: [], page: 1, pageSize, total: 0, totalPages: 1 };
  }

  const baseRows: Array<{ id: string; data: DocumentData }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const status = String(data.status ?? "draft");
    if (status === "draft" || status === "cancelled") continue;
    baseRows.push({ id: doc.id, data });
  }

  const linkedIds = [
    ...new Set(
      baseRows
        .map((row) =>
          typeof row.data.linkedVideoId === "string" ?
            row.data.linkedVideoId.trim() :
            "",
        )
        .filter(Boolean),
    ),
  ];

  const linkedById = new Map<string, PublicResourceVideo | null>();
  await Promise.all(
    linkedIds.map(async (videoId) => {
      const video = await getPublicResourceVideo(videoId, { allowArchived: true });
      linkedById.set(videoId, video);
    }),
  );

  const mapped = baseRows
    .map((row) => {
      const linkedId =
        typeof row.data.linkedVideoId === "string" ?
          row.data.linkedVideoId.trim() :
          "";
      return mapPublicEvent(
        row.id,
        row.data,
        nowMs,
        linkedId ? linkedById.get(linkedId) ?? null : null,
      );
    })
    .filter((item): item is PublicWebinarEvent => Boolean(item))
    .filter((item) => (archives ? isArchiveEvent(item) : isLatestEvent(item)));

  mapped.sort((a, b) => {
    const aStart = a.startsAt ?? "";
    const bStart = b.startsAt ?? "";
    return archives ? bStart.localeCompare(aStart) : aStart.localeCompare(bStart);
  });

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
