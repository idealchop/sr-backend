/** Root collection `apps_feedback` — cross-app partner feedback (API writes only). */

export const APPS_FEEDBACK_APP_ID_SMARTREFILL = "smartrefill";

export type PlatformFeedbackInput = {
  appId: string;
  source: string;
  businessId: string;
  userId: string;
  userEmail?: string;
  displayName?: string;
  rating: number;
  feedback?: string;
  recommend?: boolean | null;
  nextUpdateSuggestion?: string;
  plan?: string;
  role?: string;
};

export type AppsFeedbackAcknowledgement = {
  status: "pending" | "acknowledged";
  acknowledgedAt: string | null;
  acknowledgedByUid: string | null;
  acknowledgedByEmail: string | null;
  note: string | null;
};

export type AppsFeedbackDocument = {
  appId: string;
  source: string;
  submittedBy: {
    userId: string;
    email: string | null;
    displayName: string | null;
    role: string | null;
  };
  business: {
    businessId: string;
    name: string;
    phone: string | null;
    ownerId: string | null;
    plan: string | null;
  };
  feedback: {
    platformSatisfactionRating: number;
    wouldRecommend: boolean | null;
    currentExperience: string;
    featureWishlist: string;
  };
  acknowledgement: AppsFeedbackAcknowledgement;
  submittedAt: unknown;
  createdAt: unknown;
};

/** API response shape. */
export type PlatformFeedbackRecord = {
  id: string;
  appId: string;
  source: string;
  businessId: string;
  businessName: string;
  userId: string;
  userEmail?: string;
  displayName?: string;
  role?: string;
  plan?: string;
  rating: number;
  feedback: string;
  recommend: boolean | null;
  nextUpdateSuggestion: string;
  acknowledgement: AppsFeedbackAcknowledgement;
  submittedAt: string;
};
