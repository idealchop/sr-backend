import express from "express";
import {
  listMyBusinesses,
  getBusiness,
  updateBusiness,
  createBusiness,
  deleteBusiness,
  deleteMultipleBusinesses,
  updateBusinessUIConfig,
  patchBusinessOnboardingProgress,
} from "../handlers/business-handler";
import { syncGettingStarted } from "../handlers/getting-started-handler";
import {
  getMyPlatformFeedback,
  postPlatformFeedback,
} from "../handlers/platform-feedback-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

import customerRoutes from "./customer-routes";
import riderRoutes from "./rider-routes";
import riderCashRemittanceRoutes from "./rider-cash-remittance-routes";
import transactionRoutes from "./transaction-routes";
import deliveryRoutes from "./delivery-routes";
import rawSubmissionRoutes from "./raw-submission-routes";
import teamHubRoutes from "./team-hub-routes";
import supportRoutes from "./support-routes";
import aiToolRoutes from "./ai-tool-routes";
import proactiveScheduleWeekRoutes from "./proactive-schedule-week-routes";
import scaleRoutes from "./scale-routes";
import ownerDeviceRoutes from "./owner-device-routes";
import analyticsRoutes from "./analytics-routes";
import globalAnalyticsRoutes from "./global-analytics-routes";
import {
  getCommunityDispatchDirectoryPreview,
  getCommunityDispatchSettingsHandler,
  getPendingCommunityDispatchOffer,
  patchCommunityDispatchSettingsHandler,
  postAcceptCommunityDispatchOffer,
  postDeclineCommunityDispatchOffer,
  postNotifyCommunityDispatchOffer,
} from "../handlers/community-dispatch-handler";
import { validateBusinessAccess } from "../middleware/business-middleware";
import { getOfflineSnapshot } from "../handlers/offline-snapshot-handler";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/", validateFirebaseIdToken, listMyBusinesses);
router.post("/create", validateFirebaseIdToken, createBusiness);
router.use(
  "/analytics",
  validateFirebaseIdToken,
  globalAnalyticsRoutes,
);
router.get(
  "/community-dispatch/directory",
  validateFirebaseIdToken,
  getCommunityDispatchDirectoryPreview,
);
router.post(
  "/community-dispatch/ops/notify-offer",
  validateFirebaseIdToken,
  postNotifyCommunityDispatchOffer,
);
router.get("/:businessId", validateFirebaseIdToken, getBusiness);
router.put("/:businessId", validateFirebaseIdToken, updateBusiness);
router.delete("/:businessId", validateFirebaseIdToken, deleteBusiness);
router.post("/bulk-delete", validateFirebaseIdToken, deleteMultipleBusinesses);
router.use(
  "/:businessId/analytics",
  validateFirebaseIdToken,
  validateBusinessAccess,
  analyticsRoutes,
);
router.patch(
  "/:businessId/ui-config",
  validateFirebaseIdToken,
  updateBusinessUIConfig,
);
router.patch(
  "/:businessId/onboarding-progress",
  validateFirebaseIdToken,
  validateBusinessAccess,
  patchBusinessOnboardingProgress,
);
router.get(
  "/:businessId/community-dispatch",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getCommunityDispatchSettingsHandler,
);
router.patch(
  "/:businessId/community-dispatch",
  validateFirebaseIdToken,
  validateBusinessAccess,
  patchCommunityDispatchSettingsHandler,
);
router.get(
  "/:businessId/community-dispatch/pending-offer",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getPendingCommunityDispatchOffer,
);
router.post(
  "/:businessId/community-dispatch/offers/:offerId/accept",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postAcceptCommunityDispatchOffer,
);
router.post(
  "/:businessId/community-dispatch/offers/:offerId/decline",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postDeclineCommunityDispatchOffer,
);
router.get(
  "/:businessId/getting-started/sync",
  validateFirebaseIdToken,
  validateBusinessAccess,
  syncGettingStarted,
);
router.get(
  "/:businessId/offline-snapshot",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getOfflineSnapshot,
);

router.get(
  "/:businessId/platform-feedback/me",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getMyPlatformFeedback,
);
router.post(
  "/:businessId/platform-feedback",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postPlatformFeedback,
);

router.use(
  "/:businessId/team",
  validateFirebaseIdToken,
  validateBusinessAccess,
  teamHubRoutes,
);

router.use("/:businessId/support", supportRoutes);

// Scoped subcollections
router.use("/:businessId/customers", customerRoutes);
router.use("/:businessId/riders", riderRoutes);
router.use(
  "/:businessId/rider-cash-remittances",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderCashRemittanceRoutes,
);
router.use("/:businessId/transactions", transactionRoutes);
router.use("/:businessId/deliveries", deliveryRoutes);
router.use("/:businessId/raw-submissions", rawSubmissionRoutes);
router.use("/:businessId/ai-tools", aiToolRoutes);
router.use("/:businessId/proactive-schedule-week", proactiveScheduleWeekRoutes);
router.use(
  "/:businessId/scale",
  validateFirebaseIdToken,
  validateBusinessAccess,
  scaleRoutes,
);
router.use(
  "/:businessId/owner-devices",
  ownerDeviceRoutes,
);

export default router;
