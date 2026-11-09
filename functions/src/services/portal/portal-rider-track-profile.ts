import { db } from "../../config/firebase-admin";
import { normalizePortalStarRating } from "./portal-rating-updates";

function effectiveRiderStarRating(tx: Record<string, unknown>): number | undefined {
  return (
    normalizePortalStarRating(tx.riderRating) ??
    normalizePortalStarRating(tx.rating) ??
    normalizePortalStarRating(tx.serviceRating)
  );
}

/** Fallback scan cap (unchanged from the original computation). */
export const RIDER_RATING_SCAN_LIMIT = 200;
/** Read-cost: reuse a computed fallback average across track polls. */
export const RIDER_RATING_CACHE_TTL_MS = 10 * 60 * 1000;
const RIDER_RATING_CACHE_MAX = 500;

type CachedRating = { value: number | null; expiresAt: number };
const riderRatingCache = new Map<string, CachedRating>();
const riderRatingInflight = new Map<string, Promise<number | null>>();

/** Test hook. */
export function clearRiderRatingCache(): void {
  riderRatingCache.clear();
  riderRatingInflight.clear();
}

/**
 * Stored aggregate on the rider record, when present
 * (`avgRating` 1–5 with optional `ratingCount`, or `ratingStats: { avg, count }`).
 * @param {Record<string, unknown>|undefined} riderData Rider document data.
 * @return {number|null|undefined} Rounded average, null when count is 0,
 *   undefined when no stored aggregate exists.
 */
export function readStoredRiderRating(
  riderData: Record<string, unknown> | undefined,
): number | null | undefined {
  if (!riderData) return undefined;
  const stats =
    riderData.ratingStats && typeof riderData.ratingStats === "object" ?
      (riderData.ratingStats as Record<string, unknown>) :
      undefined;
  const avgRaw = riderData.avgRating ?? stats?.avg;
  const countRaw = riderData.ratingCount ?? stats?.count;
  if (typeof countRaw === "number" && countRaw <= 0) return null;
  if (typeof avgRaw !== "number" || !Number.isFinite(avgRaw)) return undefined;
  if (avgRaw < 1 || avgRaw > 5) return undefined;
  return Math.round(avgRaw * 10) / 10;
}

/**
 * Average customer star rating for a rider (1–5), from assigned transactions.
 * @param {string} businessId Business id.
 * @param {string} riderId Rider document id.
 * @return {Promise<number|null>} Rounded average or null when no ratings exist.
 */
export async function computeRiderAverageRating(
  businessId: string,
  riderId: string,
): Promise<number | null> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("riderId", "==", riderId)
    .limit(RIDER_RATING_SCAN_LIMIT)
    .get();

  let sum = 0;
  let count = 0;
  for (const doc of snap.docs) {
    const rating = effectiveRiderStarRating(doc.data());
    if (rating != null) {
      sum += rating;
      count += 1;
    }
  }
  if (count <= 0) {
    return null;
  }
  return Math.round((sum / count) * 10) / 10;
}

/**
 * Rider average for the public track page. Prefers a stored aggregate on the
 * rider doc (0 extra reads). Otherwise computes once and caches per instance
 * for 10 minutes, so a 12–20 s track poll no longer re-reads 200 transactions.
 * @param {string} businessId Business id.
 * @param {string} riderId Rider document id.
 * @param {Record<string, unknown>|undefined} riderData Rider doc (already read).
 * @param {number} [now] Clock override for tests.
 * @return {Promise<number|null>}
 */
export async function resolveRiderAverageRating(
  businessId: string,
  riderId: string,
  riderData: Record<string, unknown> | undefined,
  now = Date.now(),
): Promise<number | null> {
  const stored = readStoredRiderRating(riderData);
  if (stored !== undefined) return stored;

  const key = `${businessId}/${riderId}`;
  const cached = riderRatingCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = riderRatingInflight.get(key);
  if (pending) return pending;

  const run = computeRiderAverageRating(businessId, riderId)
    .then((value) => {
      if (riderRatingCache.size >= RIDER_RATING_CACHE_MAX) {
        const oldest = riderRatingCache.keys().next().value;
        if (oldest !== undefined) riderRatingCache.delete(oldest);
      }
      riderRatingCache.set(key, {
        value,
        expiresAt: now + RIDER_RATING_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      riderRatingInflight.delete(key);
    });
  riderRatingInflight.set(key, run);
  return run;
}

export type PortalRiderTrackProfile = {
  riderName: string;
  riderPhotoUrl?: string;
  riderPhone?: string;
  riderAvgRating: number | null;
  /** True when the rider has no linked Firebase Auth account (directory record only). */
  riderIsRecordOnly: boolean;
};

/** Riders without `userId` cannot share live GPS via the companion app. */
export function isRecordOnlyRider(
  riderData: Record<string, unknown> | undefined,
): boolean {
  const userId = riderData?.userId;
  return !userId || !String(userId).trim();
}

export async function resolvePortalRiderTrackProfile(
  businessId: string,
  riderId: string,
  riderData: Record<string, unknown> | undefined,
  fallbackName?: string,
): Promise<PortalRiderTrackProfile> {
  const riderName =
    (typeof riderData?.name === "string" && riderData.name.trim()) ||
    fallbackName?.trim() ||
    "Rider";
  const riderPhotoUrl =
    typeof riderData?.photoUrl === "string" && riderData.photoUrl.trim() ?
      riderData.photoUrl.trim() :
      undefined;
  const riderPhone =
    typeof riderData?.phone === "string" && riderData.phone.trim() ?
      riderData.phone.trim() :
      undefined;
  const riderAvgRating = await resolveRiderAverageRating(
    businessId,
    riderId,
    riderData,
  );

  return {
    riderName,
    riderPhotoUrl,
    riderPhone,
    riderAvgRating,
    riderIsRecordOnly: isRecordOnlyRider(riderData),
  };
}
