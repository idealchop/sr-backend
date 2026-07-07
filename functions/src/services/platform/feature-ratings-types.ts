/** Root collection `feature_ratings` — per-feature UX ratings (API writes only). */

export const APPS_FEATURE_RATINGS_APP_ID_SMARTREFILL = "smartrefill";

export const INVENTORY_CONTAINER_REVAMP_FEATURE_ID = "inventory-container-revamp";

export const COMMUNITY_MESSENGER_DISPATCH_FEATURE_ID = "community-messenger-dispatch";

export const RIDER_MESSENGER_COMMANDS_FEATURE_ID = "rider-messenger-commands";

export const CUSTOMER_STATUS_TERMINOLOGY_FEATURE_ID = "customer-status-terminology";

export type FeatureLifecycle = "active" | "decommissioned";

export type FeatureRatingCategory = "uiLayout" | "functionality";

export type FeatureRatingsInput = {
  appId: string;
  source: string;
  businessId: string;
  userId: string;
  userEmail?: string;
  displayName?: string;
  role?: string;
  featureId: string;
  ratings: Record<FeatureRatingCategory, number>;
  feedback?: string;
};

export type FeatureRatingsAcknowledgement = {
  status: "pending" | "acknowledged";
  acknowledgedAt: string | null;
  acknowledgedByUid: string | null;
  acknowledgedByEmail: string | null;
  note: string | null;
};

export type FeatureRatingsDocument = {
  appId: string;
  source: string;
  featureId: string;
  featureName: string;
  featureLifecycle: FeatureLifecycle;
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
  };
  ratings: {
    uiLayout: number;
    functionality: number;
  };
  feedback: string;
  acknowledgement: FeatureRatingsAcknowledgement;
  submittedAt: unknown;
  createdAt: unknown;
};

/** Registry doc `platform_features/{featureId}` */
export type PlatformFeatureDocument = {
  featureId: string;
  name: string;
  lifecycle: FeatureLifecycle;
  description?: string;
  updatedAt?: unknown;
  createdAt?: unknown;
};

export type FeatureRatingRecord = {
  id: string;
  appId: string;
  source: string;
  featureId: string;
  featureName: string;
  featureLifecycle: FeatureLifecycle;
  businessId: string;
  businessName: string;
  userId: string;
  userEmail?: string;
  displayName?: string;
  role?: string;
  ratings: {
    uiLayout: number;
    functionality: number;
  };
  feedback: string;
  acknowledgement: FeatureRatingsAcknowledgement;
  submittedAt: string;
};
