import express from "express";
import {
  listProductionShifts,
  upsertProductionShift,
} from "../handlers/production-shift-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listProductionShifts);
router.post("/:businessId", validateFirebaseIdToken, upsertProductionShift);

export default router;
