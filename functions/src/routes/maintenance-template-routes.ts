import express from "express";
import {
  completeMaintenanceTemplate,
  getPlantStaffQrToken,
  listMaintenanceTemplates,
  updateMaintenanceTemplate,
} from "../handlers/maintenance-template-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listMaintenanceTemplates);
router.get(
  "/:businessId/staff-qr",
  validateFirebaseIdToken,
  getPlantStaffQrToken,
);
router.post(
  "/:businessId/:templateId/complete",
  validateFirebaseIdToken,
  completeMaintenanceTemplate,
);
router.patch(
  "/:businessId/:templateId",
  validateFirebaseIdToken,
  updateMaintenanceTemplate,
);

export default router;
