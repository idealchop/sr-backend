import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";

type BusinessCommunityDispatch = {
  enabled?: boolean;
  acceptingOrders?: boolean;
  publicName?: string;
  slug?: string;
};

function readMapPin(data: FirebaseFirestore.DocumentData): boolean {
  const location = data.location as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/**
 * Scale / Enterprise / trial stations with a map pin join community dispatch automatically.
 * Grow / Starter are removed from the directory when the plan no longer qualifies.
 */
export async function syncCommunityDispatchEnrollment(businessId: string): Promise<void> {
  const ref = db.collection("businesses").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data()!;
  const planEligible = await isBusinessEligibleForCommunityMessenger(businessId);
  const hasMapPin = readMapPin(data);
  const community = (data.communityDispatch ?? {}) as BusinessCommunityDispatch;
  const businessName = typeof data.name === "string" ? data.name.trim() : "";

  if (planEligible && hasMapPin) {
    const publicName =
      typeof community.publicName === "string" && community.publicName.trim() ?
        community.publicName.trim() :
        businessName;
    await ref.set(
      {
        communityDispatch: {
          enabled: true,
          publicName,
          ...(community.slug?.trim() ? { slug: community.slug.trim().toLowerCase() } : {}),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  if (community.enabled === true) {
    await ref.set(
      {
        communityDispatch: {
          enabled: false,
          ...(community.publicName ? { publicName: community.publicName } : {}),
          ...(community.slug ? { slug: community.slug } : {}),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.info("syncCommunityDispatchEnrollment disabled", { businessId, planEligible, hasMapPin });
  }
}
