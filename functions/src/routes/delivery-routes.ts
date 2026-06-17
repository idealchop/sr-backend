import express from "express";
import { deliveryHandler } from "../handlers/deliveries/delivery-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

// Mounted at /businesses/:businessId/deliveries
router.get(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.listDeliveries,
);
router.get(
  "/active",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.listActive,
);
router.get(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.getDelivery,
);
router.post(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.createDelivery,
);
router.post(
  "/:id/assign",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.assignRider,
);
router.post(
  "/:id/complete",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.completeDelivery,
);

router.post(
  "/share",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deliveryHandler.shareRoute,
);

export default router;
