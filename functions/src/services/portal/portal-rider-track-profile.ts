import { db } from "../../config/firebase-admin";
import { normalizePortalStarRating } from "./portal-rating-updates";

function effectiveRiderStarRating(tx: Record<string, unknown>): number | undefined {
  return (
    normalizePortalStarRating(tx.riderRating) ??
    normalizePortalStarRating(tx.rating) ??
    normalizePortalStarRating(tx.serviceRating)
  );
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
    .limit(200)
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

export type PortalRiderTrackProfile = {
  riderName: string;
  riderPhotoUrl?: string;
  riderPhone?: string;
  riderAvgRating: number | null;
};

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
  const riderAvgRating = await computeRiderAverageRating(businessId, riderId);

  return {
    riderName,
    riderPhotoUrl,
    riderPhone,
    riderAvgRating,
  };
}
