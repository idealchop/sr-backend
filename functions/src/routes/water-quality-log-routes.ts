import express from "express";
import {
  createWaterQualityLog,
  listWaterQualityLogs,
} from "../handlers/water-quality-log-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listWaterQualityLogs);
router.post("/:businessId", validateFirebaseIdToken, createWaterQualityLog);

export default router;
