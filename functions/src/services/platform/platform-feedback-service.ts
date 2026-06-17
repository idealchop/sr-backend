import { db, FieldValue } from "../../config/firebase-admin";
import type {
  AppsFeedbackDocument,
  PlatformFeedbackInput,
  PlatformFeedbackRecord,
} from "./platform-feedback-types";
import { APPS_FEEDBACK_APP_ID_SMARTREFILL } from "./platform-feedback-types";

const COLLECTION = "apps_feedback";

/**
 * Normalizes legacy client ids to the canonical Firestore value.
 * @param {string} [appId] Client app id (e.g. smartrefill-v3).
 * @return {string}
 */
export function normalizeAppsFeedbackAppId(appId?: string): string {
  const raw = String(appId ?? APPS_FEEDBACK_APP_ID_SMARTREFILL).trim().toLowerCase();
  if (raw === "smartrefill-v3" || raw === "smartrefill") {
    return APPS_FEEDBACK_APP_ID_SMARTREFILL;
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

function pendingAcknowledgement(): AppsFeedbackDocument["acknowledgement"] {
  return {
    status: "pending",
    acknowledgedAt: null,
    acknowledgedByUid: null,
    acknowledgedByEmail: null,
    note: null,
  };
}

function resolveAppIdFromDoc(
  data: FirebaseFirestore.DocumentData,
  fallback: string,
): string {
  const legacyNested = data.app?.id;
  return normalizeAppsFeedbackAppId(
    String(data.appId ?? legacyNested ?? fallback),
  );
}

function recordFromDoc(
  docId: string,
  data: FirebaseFirestore.DocumentData,
  fallbackAppId: string,
): PlatformFeedbackRecord {
  const appId = resolveAppIdFromDoc(data, fallbackAppId);
  const businessId = String(data.business?.businessId ?? data.businessId ?? "");
  const submittedBy = data.submittedBy ?? {};
  const feedbackBlock = data.feedback ?? {};
  const acknowledgement = data.acknowledgement ?? pendingAcknowledgement();

  return {
    id: docId,
    appId,
    source: String(data.source ?? ""),
    businessId,
    businessName: String(data.business?.name ?? ""),
    userId: String(submittedBy.userId ?? data.userId ?? ""),
    userEmail: submittedBy.email ?? data.userEmail ?? undefined,
    displayName: submittedBy.displayName ?? data.displayName ?? undefined,
    role: submittedBy.role ?? data.role ?? undefined,
    plan: data.business?.plan ?? data.plan ?? undefined,
    rating: Number(
      feedbackBlock.platformSatisfactionRating ?? data.rating ?? 0,
    ),
    feedback: String(
      feedbackBlock.currentExperience ?? data.feedback ?? "",
    ),
    recommend:
      feedbackBlock.wouldRecommend === true ?
        true :
        feedbackBlock.wouldRecommend === false ?
          false :
          data.recommend === true ?
            true :
            data.recommend === false ?
              false :
              null,
    nextUpdateSuggestion: String(
      feedbackBlock.featureWishlist ?? data.nextUpdateSuggestion ?? "",
    ),
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

export class PlatformFeedbackService {
  static async submit(
    input: PlatformFeedbackInput,
  ): Promise<PlatformFeedbackRecord> {
    const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
    const currentExperience = String(input.feedback ?? "")
      .trim()
      .slice(0, 4000);
    const featureWishlist = String(input.nextUpdateSuggestion ?? "")
      .trim()
      .slice(0, 2000);
    const wouldRecommend =
      input.recommend === true ?
        true :
        input.recommend === false ?
          false :
          null;

    const appId = normalizeAppsFeedbackAppId(input.appId);

    const businessSnap = await db
      .collection("businesses")
      .doc(input.businessId)
      .get();
    const businessData = businessSnap.data();

    const doc: AppsFeedbackDocument = {
      appId,
      source: String(input.source || "dashboard").slice(0, 64),
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
        plan: input.plan ? String(input.plan).slice(0, 64) : null,
      },
      feedback: {
        platformSatisfactionRating: rating,
        wouldRecommend,
        currentExperience,
        featureWishlist,
      },
      acknowledgement: pendingAcknowledgement(),
      submittedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    const ref = await db.collection(COLLECTION).add(doc);

    const userFeedbackSnapshot = {
      rating,
      feedback: currentExperience,
      recommend: wouldRecommend,
      nextUpdateSuggestion: featureWishlist,
      submittedAt: FieldValue.serverTimestamp(),
    };

    await db
      .collection("businesses")
      .doc(input.businessId)
      .set({ userFeedback: userFeedbackSnapshot }, { merge: true });

    return recordFromDoc(ref.id, doc as unknown as FirebaseFirestore.DocumentData, appId);
  }

  static async getLatestForUser(
    businessId: string,
    userId: string,
    appId = APPS_FEEDBACK_APP_ID_SMARTREFILL,
  ): Promise<PlatformFeedbackRecord | null> {
    const normalizedAppId = normalizeAppsFeedbackAppId(appId);

    const snap = await db
      .collection(COLLECTION)
      .where("appId", "==", normalizedAppId)
      .where("business.businessId", "==", businessId)
      .where("submittedBy.userId", "==", userId)
      .limit(25)
      .get();

    let matching = snap.docs;

    if (!matching.length) {
      const legacySnap = await db
        .collection(COLLECTION)
        .where("businessId", "==", businessId)
        .where("userId", "==", userId)
        .limit(25)
        .get();
      matching = legacySnap.docs.filter(
        (d) => resolveAppIdFromDoc(d.data(), "") === normalizedAppId,
      );
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
