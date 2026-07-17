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
import {
  getMyFeatureRatings,
  postFeatureRatings,
} from "../handlers/feature-ratings-handler";
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
import {
  listCommunityInquiryMessagesHandler,
  listCommunityInquiryThreadsHandler,
  postCommunityInquiryReplyHandler,
} from "../handlers/community-inquiry-handler";
import { validateBusinessAccess } from "../middleware/business-middleware";
import { getOfflineSnapshot } from "../handlers/offline-snapshot-handler";
import {
  deleteRiderMessengerLink,
  deleteRiderMessengerLinkMe,
  getRiderMessengerLinkStatus,
  getRiderMessengerLinkStatusMe,
  postRiderMessengerLinkCode,
  postRiderMessengerLinkCodeMe,
} from "../handlers/rider-messenger-handler";
import {
  deleteTeamMessengerLinkMe,
  getTeamMessengerLinkStatusMe,
  postTeamMessengerLinkCodeMe,
} from "../handlers/team-messenger-handler";
import {
  getDeliveryMessengerChatByReferenceHandler,
  getDeliveryMessengerChatUnreadCountHandler,
  listDeliveryMessengerChatMessagesHandler,
  listDeliveryMessengerChatsHandler,
  postDeliveryMessengerChatMarkReadHandler,
  postDeliveryMessengerChatReplyHandler,
} from "../handlers/delivery-messenger-chat-handler";

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
router.get(
  "/community-dispatch/inquiry-threads",
  validateFirebaseIdToken,
  listCommunityInquiryThreadsHandler,
);
router.get(
  "/community-dispatch/inquiry-threads/:threadId/messages",
  validateFirebaseIdToken,
  listCommunityInquiryMessagesHandler,
);
router.post(
  "/community-dispatch/inquiry-threads/:threadId/reply",
  validateFirebaseIdToken,
  postCommunityInquiryReplyHandler,
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
  "/:businessId/community-dispatch/delivery-chats/unread-count",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getDeliveryMessengerChatUnreadCountHandler,
);
router.get(
  "/:businessId/community-dispatch/delivery-chats/by-reference/:referenceId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getDeliveryMessengerChatByReferenceHandler,
);
router.get(
  "/:businessId/community-dispatch/delivery-chats",
  validateFirebaseIdToken,
  validateBusinessAccess,
  listDeliveryMessengerChatsHandler,
);
router.get(
  "/:businessId/community-dispatch/delivery-chats/:threadId/messages",
  validateFirebaseIdToken,
  validateBusinessAccess,
  listDeliveryMessengerChatMessagesHandler,
);
router.post(
  "/:businessId/community-dispatch/delivery-chats/:threadId/reply",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postDeliveryMessengerChatReplyHandler,
);
router.post(
  "/:businessId/community-dispatch/delivery-chats/:threadId/read",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postDeliveryMessengerChatMarkReadHandler,
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

router.post(
  "/:businessId/rider-messenger/link-code",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postRiderMessengerLinkCode,
);
router.get(
  "/:businessId/rider-messenger/link-code/:riderId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getRiderMessengerLinkStatus,
);
router.delete(
  "/:businessId/rider-messenger/link/:riderId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deleteRiderMessengerLink,
);
router.post(
  "/:businessId/rider-messenger/me/link-code",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postRiderMessengerLinkCodeMe,
);
router.get(
  "/:businessId/rider-messenger/me/link-status",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getRiderMessengerLinkStatusMe,
);
router.delete(
  "/:businessId/rider-messenger/me/link",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deleteRiderMessengerLinkMe,
);

router.post(
  "/:businessId/team-messenger/me/link-code",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postTeamMessengerLinkCodeMe,
);
router.get(
  "/:businessId/team-messenger/me/link-status",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getTeamMessengerLinkStatusMe,
);
router.delete(
  "/:businessId/team-messenger/me/link",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deleteTeamMessengerLinkMe,
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

router.get(
  "/:businessId/feature-ratings/me",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getMyFeatureRatings,
);
router.post(
  "/:businessId/feature-ratings",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postFeatureRatings,
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
