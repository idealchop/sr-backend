import { db } from "../../config/firebase-admin";
import { normalizePortalStarRating } from "./portal-rating-updates";
import { maskPortalCustomerName } from "./mask-portal-customer-name";
import { PortalOrderRatingService } from "./portal-order-rating-service";

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 20;
const AVERAGE_SAMPLE_LIMIT = 1000;

export type PortalBusinessProfileFeedbackItem = {
  id: string;
  maskedCustomerName: string;
  rating: number;
  feedback?: string;
  createdAt: string | null;
};

export type PortalBusinessProfileResult = {
  businessName: string;
  businessLogo: string | null;
  businessBanner: string | null;
  phone: string | null;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  ratings: {
    average: number | null;
    count: number;
  };
  feedback: {
    items: PortalBusinessProfileFeedbackItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function effectiveStationRating(data: FirebaseFirestore.DocumentData): number | undefined {
  const service = normalizePortalStarRating(data.serviceRating ?? data.rating);
  const wrs = normalizePortalStarRating(data.wrsRating);
  const scores = [service, wrs].filter((v): v is number => typeof v === "number");
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export class PortalBusinessProfileService {
  static async getPublicProfile(args: {
    businessId: string;
    page?: number;
    pageSize?: number;
  }): Promise<PortalBusinessProfileResult | null> {
    const businessId = String(args.businessId || "").trim();
    if (!businessId) return null;

    const page = Math.max(1, Math.floor(args.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(args.pageSize ?? DEFAULT_PAGE_SIZE)),
    );

    const bizSnap = await db.collection("businesses").doc(businessId).get();
    if (!bizSnap.exists) return null;
    const biz = bizSnap.data() || {};

    const bizLat = biz?.location?.lat ?? biz?.latitude;
    const bizLng = biz?.location?.lng ?? biz?.longitude;
    const location =
      typeof bizLat === "number" &&
      typeof bizLng === "number" &&
      Number.isFinite(bizLat) &&
      Number.isFinite(bizLng) ?
        { latitude: bizLat, longitude: bizLng } :
        null;

    const address =
      typeof biz?.location?.address === "string" && biz.location.address.trim() ?
        biz.location.address.trim() :
        typeof biz?.address === "string" && biz.address.trim() ?
          biz.address.trim() :
          null;

    const ratingsCol = PortalOrderRatingService.ratingsCol(businessId);
    const countSnap = await ratingsCol.count().get();
    const totalRatings = countSnap.data().count;

    const averageSnap = await ratingsCol
      .orderBy("createdAt", "desc")
      .limit(AVERAGE_SAMPLE_LIMIT)
      .get();

    const ratingValues: number[] = [];
    for (const doc of averageSnap.docs) {
      const effective = effectiveStationRating(doc.data());
      if (effective != null) ratingValues.push(effective);
    }

    const average =
      ratingValues.length > 0 ?
        Math.round((ratingValues.reduce((sum, v) => sum + v, 0) / ratingValues.length) * 10) /
          10 :
        null;

    const skip = (page - 1) * pageSize;
    const listSnap = await ratingsCol
      .orderBy("createdAt", "desc")
      .limit(skip + pageSize)
      .get();
    const pageDocs = listSnap.docs.slice(skip);

    const items: PortalBusinessProfileFeedbackItem[] = pageDocs
      .map((doc) => {
        const data = doc.data();
        const rating = effectiveStationRating(data);
        const feedback =
          typeof data.feedback === "string" ? data.feedback.trim().slice(0, 500) : "";
        if (rating == null && !feedback) return null;
        return {
          id: doc.id,
          maskedCustomerName: maskPortalCustomerName(data.customerName),
          rating: rating != null ? Math.round(rating) : 0,
          ...(feedback ? { feedback } : {}),
          createdAt: toIsoString(data.createdAt),
        };
      })
      .filter((row): row is PortalBusinessProfileFeedbackItem => row != null);

    const totalPages = Math.max(1, Math.ceil(totalRatings / pageSize));

    return {
      businessName: String(biz?.businessName || biz?.name || "Your water station"),
      businessLogo: typeof biz?.logo === "string" ? biz.logo : null,
      businessBanner:
        typeof biz?.banner === "string" && biz.banner.trim() ?
          biz.banner.trim() :
          null,
      phone: typeof biz?.phone === "string" && biz.phone.trim() ? biz.phone.trim() : null,
      address,
      location,
      ratings: {
        average,
        count: totalRatings,
      },
      feedback: {
        items,
        page,
        pageSize,
        total: totalRatings,
        totalPages,
      },
    };
  }
}
