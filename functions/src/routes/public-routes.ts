import express from "express";
import { rateLimit } from "express-rate-limit";
import { deliveryHandler } from "../handlers/deliveries/delivery-handler";
import { statementShareHandler } from "../handlers/customers/statement-share-handler";
import {
  getPortalCustomerContext,
  getPortalBusinessProfile,
  getQrPng,
  cancelPortalOrder,
  patchPortalCustomerProfile,
  getContainerCustodyAgreementPdf,
} from "../handlers/portal/portal-public-handler";
import { postPortalSubmission } from "../handlers/portal/portal-submission-handler";
import {
  trackOrder,
  searchTrackOrders,
} from "../handlers/portal/portal-track-handler";
import {
  getPublicPlantMaintenanceTasks,
  postPublicPlantMaintenanceComplete,
} from "../handlers/plant-public-handler";
import {
  getPublicTeamInvite,
  postAcceptTeamInvite,
  postDeclineTeamInvite,
} from "../handlers/team-invite-public-handler";
import {
  postInquiry,
  postPartnerApplication,
  postRequestDemo,
} from "../handlers/marketing-handler";
import { getPlatformStats } from "../handlers/marketing-platform-stats-handler";
import { metaCommunityWebhook } from "../handlers/meta/meta-community-webhook-handler";
import { metaCommunityWhatsappWebhook } from "../handlers/meta/meta-community-whatsapp-webhook-handler";
import { viberCommunityWebhook } from "../handlers/viber/viber-community-webhook-handler";
import {
  getMockPaymentCheckout,
  paymentProviderWebhook,
} from "../handlers/payments/payment-intent-handler";
import {
  getPublicBlogEngagement,
  getPublicResourceVideoById,
  getPublicWebinarEvents,
  getPublicWebinarRecordings,
  getPublicWrsBlogById,
  getPublicWrsBlogs,
  getPublicWrsStories,
} from "../handlers/public-resources-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
});

const statementShareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
});

const marketingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
});

const marketingStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
});

const resourcesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
});

// Public endpoints
router.get("/shared-route/:id", deliveryHandler.getSharedRoute);
router.get(
  "/statement/:id",
  statementShareLimiter,
  statementShareHandler.getStatementSharePublic,
);

router.get("/qr.png", getQrPng);
router.get("/portal/customer", portalLimiter, getPortalCustomerContext);
router.get(
  "/portal/container-custody-agreement",
  portalLimiter,
  getContainerCustodyAgreementPdf,
);
router.get("/portal/business-profile", portalLimiter, getPortalBusinessProfile);
router.get("/portal/track/search", portalLimiter, searchTrackOrders);
router.get("/portal/track/:referenceId", portalLimiter, trackOrder);
router.post("/portal/submissions", portalLimiter, postPortalSubmission);
router.post("/portal/cancel", portalLimiter, cancelPortalOrder);
router.patch("/portal/profile", portalLimiter, patchPortalCustomerProfile);

router.get("/plant/maintenance/tasks", portalLimiter, getPublicPlantMaintenanceTasks);
router.post("/plant/maintenance/complete", portalLimiter, postPublicPlantMaintenanceComplete);

router.get("/team-invites/:token", getPublicTeamInvite);
router.post(
  "/team-invites/:token/accept",
  validateFirebaseIdToken,
  postAcceptTeamInvite,
);
router.post(
  "/team-invites/:token/decline",
  validateFirebaseIdToken,
  postDeclineTeamInvite,
);

router.post("/marketing/request-demo", marketingLimiter, postRequestDemo);
router.post("/marketing/inquiry", marketingLimiter, postInquiry);
router.post(
  "/marketing/partner-application",
  marketingLimiter,
  postPartnerApplication,
);
router.get(
  "/marketing/platform-stats",
  marketingStatsLimiter,
  getPlatformStats,
);

/** Public Events & Training marketing catalogs (published + visibility:public). */
router.get("/resources/wrs-stories", resourcesLimiter, getPublicWrsStories);
router.get("/resources/webinars", resourcesLimiter, getPublicWebinarRecordings);
router.get("/resources/webinar-events", resourcesLimiter, getPublicWebinarEvents);
router.get("/resources/blogs", resourcesLimiter, getPublicWrsBlogs);
router.get(
  "/resources/blogs/:articleId/engagement",
  resourcesLimiter,
  getPublicBlogEngagement,
);
router.get("/resources/blogs/:idOrSlug", resourcesLimiter, getPublicWrsBlogById);
router.get(
  "/resources/videos/:videoId",
  resourcesLimiter,
  getPublicResourceVideoById,
);

router.get("/webhooks/meta/community", metaCommunityWebhook);
router.post("/webhooks/meta/community", metaCommunityWebhook);
router.get("/webhooks/meta/whatsapp/community", metaCommunityWhatsappWebhook);
router.post("/webhooks/meta/whatsapp/community", metaCommunityWhatsappWebhook);
router.post("/webhooks/viber/community", viberCommunityWebhook);

router.post("/webhooks/payments/mock", paymentProviderWebhook("mock"));
router.post("/webhooks/payments/paymongo", paymentProviderWebhook("paymongo"));
router.get("/payments/mock-checkout/:intentId", portalLimiter, getMockPaymentCheckout);
router.post("/payments/mock-checkout/:intentId", portalLimiter, getMockPaymentCheckout);

export default router;
