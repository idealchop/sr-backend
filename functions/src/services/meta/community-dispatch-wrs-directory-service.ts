import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";
import { sortByDistanceKm } from "./community-dispatch-geo-utils";
import type { CommunityWrsDirectoryEntry } from "./community-dispatch-request-types";

type BusinessCommunityDispatch = {
  enabled?: boolean;
  publicName?: string;
  slug?: string;
};

function readLatLng(data: FirebaseFirestore.DocumentData): { lat: number; lng: number } | null {
  const location = data.location as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function mapBusinessToDirectoryEntry(
  businessId: string,
  data: FirebaseFirestore.DocumentData,
): CommunityWrsDirectoryEntry | null {
  const community = data.communityDispatch as BusinessCommunityDispatch | undefined;
  if (community?.enabled !== true) return null;

  const coords = readLatLng(data);
  if (!coords) return null;

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return null;

  const publicName =
    typeof community.publicName === "string" && community.publicName.trim() ?
      community.publicName.trim() :
      name;
  const slug =
    typeof community.slug === "string" && community.slug.trim() ?
      community.slug.trim().toLowerCase() :
      undefined;

  return {
    businessId,
    name,
    publicName,
    slug,
    lat: coords.lat,
    lng: coords.lng,
    acceptingOrders: true,
  };
}

/**
 * CP-06 — Scale / Enterprise / trial WRS with map pins (auto-enrolled, first accept wins).
 */
export async function loadCommunityWrsDirectory(): Promise<CommunityWrsDirectoryEntry[]> {
  try {
    const snap = await db
      .collection("businesses")
      .where("communityDispatch.enabled", "==", true)
      .get();

    const candidates: CommunityWrsDirectoryEntry[] = [];
    for (const doc of snap.docs) {
      const entry = mapBusinessToDirectoryEntry(doc.id, doc.data());
      if (entry) candidates.push(entry);
    }

    const eligibility = await Promise.all(
      candidates.map(async (entry) => ({
        entry,
        eligible: await isBusinessEligibleForCommunityMessenger(entry.businessId),
      })),
    );

    const rows = eligibility.filter((row) => row.eligible).map((row) => row.entry);

    logger.info("loadCommunityWrsDirectory", {
      optedInCount: candidates.length,
      eligibleCount: rows.length,
    });
    return rows;
  } catch (error) {
    logger.error("loadCommunityWrsDirectory failed", error);
    return [];
  }
}

/** CP-06 helper — sort candidates nearest-first when customer coordinates exist. */
export function rankWrsByCustomerLocation(
  directory: CommunityWrsDirectoryEntry[],
  customerLat: number,
  customerLng: number,
): Array<CommunityWrsDirectoryEntry & { distanceKm: number }> {
  return sortByDistanceKm(customerLat, customerLng, directory);
}
