import express from "express";
import { rateLimit } from "express-rate-limit";
import { deliveryHandler } from "../handlers/deliveries/delivery-handler";
import { statementShareHandler } from "../handlers/customers/statement-share-handler";
import {
  getPortalCustomerContext,
  getQrPng,
  postPortalSubmission,
  trackOrder,
  searchTrackOrders,
  cancelPortalOrder,
  patchPortalCustomerProfile,
} from "../handlers/portal/portal-public-handler";
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

// Public endpoints
router.get("/shared-route/:id", deliveryHandler.getSharedRoute);
router.get(
  "/statement/:id",
  statementShareLimiter,
  statementShareHandler.getStatementSharePublic,
);

router.get("/qr.png", getQrPng);
router.get("/portal/customer", portalLimiter, getPortalCustomerContext);
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

export default router;
