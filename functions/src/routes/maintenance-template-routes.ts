import express from "express";
import {
  completeMaintenanceTemplate,
  listMaintenanceTemplates,
} from "../handlers/maintenance-template-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listMaintenanceTemplates);
router.post(
  "/:businessId/:templateId/complete",
  validateFirebaseIdToken,
  completeMaintenanceTemplate,
);

export default router;
