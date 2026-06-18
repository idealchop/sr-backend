import express from "express";
import {
  completeMaintenanceTemplate,
  getPlantStaffQrToken,
  listMaintenanceTemplates,
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

export default router;
