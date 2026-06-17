import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  validateBusinessAccess,
  requireBusinessOwner,
} from "../middleware/business-middleware";
import {
  deleteOwnerDeviceHandler,
  listOwnerDevicesHandler,
  registerOwnerDeviceHandler,
} from "../handlers/owner-device-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  listOwnerDevicesHandler,
);
router.post(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  registerOwnerDeviceHandler,
);
router.delete(
  "/:deviceId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  deleteOwnerDeviceHandler,
);

export default router;
