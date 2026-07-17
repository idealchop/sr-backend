import { db, FieldValue } from "../../config/firebase-admin";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";
import { syncCommunityDispatchEnrollment } from "./community-dispatch-enrollment-service";

export type CommunityDispatchSettingsView = {
  publicName: string;
  slug?: string;
  planEligible: boolean;
  hasMapPin: boolean;
};

type BusinessCommunityDispatch = {
  enabled?: boolean;
  publicName?: string;
  slug?: string;
};

function readMapPin(data: FirebaseFirestore.DocumentData): boolean {
  const location = data.location as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function readSettingsFromDoc(
  data: FirebaseFirestore.DocumentData,
  planEligible: boolean,
): CommunityDispatchSettingsView {
  const community = data.communityDispatch as BusinessCommunityDispatch | undefined;
  const businessName = typeof data.name === "string" ? data.name.trim() : "";
  const publicName =
    typeof community?.publicName === "string" && community.publicName.trim() ?
      community.publicName.trim() :
      businessName;
  const slug =
    typeof community?.slug === "string" && community.slug.trim() ?
      community.slug.trim().toLowerCase() :
      undefined;

  return {
    publicName,
    slug,
    planEligible,
    hasMapPin: readMapPin(data),
  };
}

export function normalizeCommunityDispatchSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug || slug.length < 3 || slug.length > 48) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return slug;
}

async function assertSlugAvailable(
  slug: string,
  businessId: string,
): Promise<boolean> {
  const snap = await db
    .collection("businesses")
    .where("communityDispatch.slug", "==", slug)
    .limit(2)
    .get();

  for (const doc of snap.docs) {
    if (doc.id !== businessId) return false;
  }
  return true;
}

export async function getCommunityDispatchSettings(
  businessId: string,
): Promise<CommunityDispatchSettingsView | null> {
  await syncCommunityDispatchEnrollment(businessId);

  const snap = await db.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const planEligible = await isBusinessEligibleForCommunityMessenger(businessId);
  return readSettingsFromDoc(data, planEligible);
}

export type PatchCommunityDispatchSettingsInput = {
  publicName?: string;
  slug?: string | null;
};

export type PatchCommunityDispatchSettingsResult =
  | { ok: true; settings: CommunityDispatchSettingsView }
  | {
    ok: false;
    code:
      | "NOT_FOUND"
      | "PLAN_NOT_ELIGIBLE"
      | "MISSING_MAP_PIN"
      | "INVALID_SLUG"
      | "SLUG_TAKEN"
      | "INVALID_PUBLIC_NAME";
  };

export async function patchCommunityDispatchSettings(
  businessId: string,
  input: PatchCommunityDispatchSettingsInput,
): Promise<PatchCommunityDispatchSettingsResult> {
  const ref = db.collection("businesses").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND" };

  const data = snap.data();
  if (!data) return { ok: false, code: "NOT_FOUND" };
  const planEligible = await isBusinessEligibleForCommunityMessenger(businessId);
  if (!planEligible) {
    return { ok: false, code: "PLAN_NOT_ELIGIBLE" };
  }

  const current = readSettingsFromDoc(data, planEligible);
  if (!current.hasMapPin) {
    return { ok: false, code: "MISSING_MAP_PIN" };
  }

  let nextPublicName = current.publicName;
  if (input.publicName !== undefined) {
    const trimmed = input.publicName.trim();
    if (!trimmed || trimmed.length > 120) {
      return { ok: false, code: "INVALID_PUBLIC_NAME" };
    }
    nextPublicName = trimmed;
  }

  let nextSlug = current.slug;
  if (input.slug !== undefined) {
    if (input.slug === null || input.slug.trim() === "") {
      nextSlug = undefined;
    } else {
      const normalized = normalizeCommunityDispatchSlug(input.slug);
      if (!normalized) return { ok: false, code: "INVALID_SLUG" };
      if (!(await assertSlugAvailable(normalized, businessId))) {
        return { ok: false, code: "SLUG_TAKEN" };
      }
      nextSlug = normalized;
    }
  }

  await ref.set(
    {
      communityDispatch: {
        enabled: true,
        publicName: nextPublicName,
        ...(nextSlug ? { slug: nextSlug } : {}),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (!nextSlug && current.slug) {
    await ref.update({ "communityDispatch.slug": FieldValue.delete() });
  }

  const updated = await getCommunityDispatchSettings(businessId);
  if (!updated) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, settings: updated };
}
