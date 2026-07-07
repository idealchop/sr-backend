import { db, FieldValue } from "../../config/firebase-admin";
import type {
  FeatureLifecycle,
  FeatureRatingCategory,
  FeatureRatingRecord,
  FeatureRatingsDocument,
  FeatureRatingsInput,
  PlatformFeatureDocument,
} from "./feature-ratings-types";
import {
  APPS_FEATURE_RATINGS_APP_ID_SMARTREFILL,
  COMMUNITY_MESSENGER_DISPATCH_FEATURE_ID,
  CUSTOMER_STATUS_TERMINOLOGY_FEATURE_ID,
  INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
  RIDER_MESSENGER_COMMANDS_FEATURE_ID,
} from "./feature-ratings-types";

const RATINGS_COLLECTION = "feature_ratings";
const FEATURES_COLLECTION = "platform_features";

const RATING_CATEGORIES: FeatureRatingCategory[] = ["uiLayout", "functionality"];

const KNOWN_FEATURES: Record<
  string,
  Pick<PlatformFeatureDocument, "name" | "lifecycle">
> = {
  [INVENTORY_CONTAINER_REVAMP_FEATURE_ID]: {
    name: "Container & Inventory Revamp",
    lifecycle: "active",
  },
  [COMMUNITY_MESSENGER_DISPATCH_FEATURE_ID]: {
    name: "Community Messenger Dispatch",
    lifecycle: "active",
  },
  [RIDER_MESSENGER_COMMANDS_FEATURE_ID]: {
    name: "Rider Messenger Commands",
    lifecycle: "active",
  },
  [CUSTOMER_STATUS_TERMINOLOGY_FEATURE_ID]: {
    name: "Customer Status Terminology",
    lifecycle: "active",
  },
};

/**
 * Normalizes legacy client ids to the canonical Firestore value.
 * @param {string} [appId] Client app id (e.g. smartrefill-v3).
 * @return {string}
 */
export function normalizeFeatureRatingsAppId(appId?: string): string {
  const raw = String(appId ?? APPS_FEATURE_RATINGS_APP_ID_SMARTREFILL)
    .trim()
    .toLowerCase();
  if (raw === "smartrefill-v3" || raw === "smartrefill") {
    return APPS_FEATURE_RATINGS_APP_ID_SMARTREFILL;
  }
  return raw.slice(0, 64);
}

function tsToIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function pendingAcknowledgement(): FeatureRatingsDocument["acknowledgement"] {
  return {
    status: "pending",
    acknowledgedAt: null,
    acknowledgedByUid: null,
    acknowledgedByEmail: null,
    note: null,
  };
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizeRatings(
  input: Record<string, unknown>,
): Record<FeatureRatingCategory, number> | null {
  const uiLayout = Number(input.uiLayout);
  const functionality = Number(input.functionality);
  if (
    !Number.isFinite(uiLayout) ||
    uiLayout < 1 ||
    uiLayout > 5 ||
    !Number.isFinite(functionality) ||
    functionality < 1 ||
    functionality > 5
  ) {
    return null;
  }
  return {
    uiLayout: clampRating(uiLayout),
    functionality: clampRating(functionality),
  };
}

async function resolveFeatureMeta(featureId: string): Promise<{
  featureId: string;
  name: string;
  lifecycle: FeatureLifecycle;
}> {
  const normalizedId = String(featureId).trim().slice(0, 96);
  const snap = await db.collection(FEATURES_COLLECTION).doc(normalizedId).get();
  if (snap.exists) {
    const data = snap.data() as PlatformFeatureDocument;
    const lifecycle =
      data.lifecycle === "decommissioned" ? "decommissioned" : "active";
    return {
      featureId: normalizedId,
      name: String(data.name ?? normalizedId).slice(0, 200),
      lifecycle,
    };
  }

  const fallback = KNOWN_FEATURES[normalizedId];
  if (fallback) {
    return {
      featureId: normalizedId,
      name: fallback.name,
      lifecycle: fallback.lifecycle,
    };
  }

  return {
    featureId: normalizedId,
    name: normalizedId,
    lifecycle: "active",
  };
}

function recordFromDoc(
  docId: string,
  data: FirebaseFirestore.DocumentData,
  fallbackAppId: string,
): FeatureRatingRecord {
  const appId = normalizeFeatureRatingsAppId(
    String(data.appId ?? fallbackAppId),
  );
  const businessId = String(data.business?.businessId ?? data.businessId ?? "");
  const submittedBy = data.submittedBy ?? {};
  const ratingsBlock = data.ratings ?? {};
  const acknowledgement = data.acknowledgement ?? pendingAcknowledgement();

  return {
    id: docId,
    appId,
    source: String(data.source ?? ""),
    featureId: String(data.featureId ?? ""),
    featureName: String(data.featureName ?? ""),
    featureLifecycle:
      data.featureLifecycle === "decommissioned" ?
        "decommissioned" :
        "active",
    businessId,
    businessName: String(data.business?.name ?? ""),
    userId: String(submittedBy.userId ?? data.userId ?? ""),
    userEmail: submittedBy.email ?? data.userEmail ?? undefined,
    displayName: submittedBy.displayName ?? data.displayName ?? undefined,
    role: submittedBy.role ?? data.role ?? undefined,
    ratings: {
      uiLayout: Number(ratingsBlock.uiLayout ?? 0),
      functionality: Number(ratingsBlock.functionality ?? 0),
    },
    feedback: String(data.feedback ?? ""),
    acknowledgement: {
      status:
        acknowledgement.status === "acknowledged" ? "acknowledged" : "pending",
      acknowledgedAt: acknowledgement.acknowledgedAt ?
        tsToIso(acknowledgement.acknowledgedAt) :
        null,
      acknowledgedByUid: acknowledgement.acknowledgedByUid ?
        String(acknowledgement.acknowledgedByUid) :
        null,
      acknowledgedByEmail: acknowledgement.acknowledgedByEmail ?
        String(acknowledgement.acknowledgedByEmail) :
        null,
      note: acknowledgement.note ? String(acknowledgement.note) : null,
    },
    submittedAt: tsToIso(data.submittedAt ?? data.createdAt),
  };
}

export class FeatureRatingsService {
  static validateRatingsPayload(
    ratings: unknown,
  ): Record<FeatureRatingCategory, number> | null {
    if (!ratings || typeof ratings !== "object") return null;
    return normalizeRatings(ratings as Record<string, unknown>);
  }

  static getRequiredCategories(): FeatureRatingCategory[] {
    return [...RATING_CATEGORIES];
  }

  static async submit(input: FeatureRatingsInput): Promise<FeatureRatingRecord> {
    const ratings = normalizeRatings(input.ratings);
    if (!ratings) {
      throw new Error("INVALID_RATINGS");
    }

    const featureId = String(input.featureId).trim().slice(0, 96);
    if (!featureId) {
      throw new Error("INVALID_FEATURE_ID");
    }

    const appId = normalizeFeatureRatingsAppId(input.appId);
    const featureMeta = await resolveFeatureMeta(featureId);
    const feedback = String(input.feedback ?? "").trim().slice(0, 4000);

    const businessSnap = await db
      .collection("businesses")
      .doc(input.businessId)
      .get();
    const businessData = businessSnap.data();

    const doc: FeatureRatingsDocument = {
      appId,
      source: String(input.source || "dashboard").slice(0, 64),
      featureId: featureMeta.featureId,
      featureName: featureMeta.name,
      featureLifecycle: featureMeta.lifecycle,
      submittedBy: {
        userId: input.userId,
        email: input.userEmail ? String(input.userEmail).slice(0, 320) : null,
        displayName: input.displayName ?
          String(input.displayName).slice(0, 200) :
          null,
        role: input.role ? String(input.role).slice(0, 64) : null,
      },
      business: {
        businessId: input.businessId,
        name: String(businessData?.name ?? "Station").slice(0, 200),
        phone: businessData?.phone ?
          String(businessData.phone).slice(0, 64) :
          null,
        ownerId: businessData?.ownerId ?
          String(businessData.ownerId) :
          null,
      },
      ratings,
      feedback,
      acknowledgement: pendingAcknowledgement(),
      submittedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    const ref = await db.collection(RATINGS_COLLECTION).add(doc);
    const saved = await ref.get();
    const savedData = saved.data();
    if (!savedData) {
      throw new Error("FEATURE_RATING_WRITE_FAILED");
    }
    return recordFromDoc(ref.id, savedData, appId);
  }

  static async getLatestForUser(
    businessId: string,
    userId: string,
    featureId: string,
    appId = APPS_FEATURE_RATINGS_APP_ID_SMARTREFILL,
  ): Promise<FeatureRatingRecord | null> {
    const normalizedAppId = normalizeFeatureRatingsAppId(appId);
    const normalizedFeatureId = String(featureId).trim().slice(0, 96);

    // Match apps_feedback: 3 equality filters (no extra composite index for featureId).
    const snap = await db
      .collection(RATINGS_COLLECTION)
      .where("appId", "==", normalizedAppId)
      .where("business.businessId", "==", businessId)
      .where("submittedBy.userId", "==", userId)
      .limit(25)
      .get();

    let matching = snap.docs.filter(
      (docSnap) => String(docSnap.data().featureId ?? "") === normalizedFeatureId,
    );

    if (!matching.length) {
      const legacySnap = await db
        .collection(RATINGS_COLLECTION)
        .where("businessId", "==", businessId)
        .where("userId", "==", userId)
        .limit(25)
        .get();
      matching = legacySnap.docs.filter((docSnap) => {
        const data = docSnap.data();
        const rowAppId = normalizeFeatureRatingsAppId(
          String(data.appId ?? ""),
        );
        return (
          rowAppId === normalizedAppId &&
          String(data.featureId ?? "") === normalizedFeatureId
        );
      });
    }

    matching.sort((a, b) => {
      const aMs = a.data().submittedAt?.toMillis?.() ?? 0;
      const bMs = b.data().submittedAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });

    if (!matching.length) return null;
    const doc = matching[0];
    return recordFromDoc(doc.id, doc.data(), normalizedAppId);
  }
}
