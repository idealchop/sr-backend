import express from "express";
import { riderHandler } from "../handlers/riders/rider-handler";
import { riderCashRemittanceHandler } from "../handlers/riders/rider-cash-remittance-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  validateBusinessAccess,
  requireBusinessOwner,
} from "../middleware/business-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

// Mounted at /businesses/:businessId/riders
router.get(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.listRiders,
);
router.get(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.getRider,
);
router.post(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.createRider,
);
router.patch(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.updateRider,
);
router.post(
  "/:id/location",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.postRiderLocation,
);
router.post(
  "/:id/cash-remittance",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  riderCashRemittanceHandler.acceptRemittance,
);
router.delete(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  riderHandler.deleteRider,
);

export default router;
