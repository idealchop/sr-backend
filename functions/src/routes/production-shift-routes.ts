import express from "express";
import {
  deleteProductionShift,
  listProductionShifts,
  updateProductionShift,
  upsertProductionShift,
} from "../handlers/production-shift-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listProductionShifts);
router.post("/:businessId", validateFirebaseIdToken, upsertProductionShift);
router.put("/:businessId/:shiftId", validateFirebaseIdToken, updateProductionShift);
router.delete("/:businessId/:shiftId", validateFirebaseIdToken, deleteProductionShift);

export default router;
