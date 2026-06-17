import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware"; import {
  getProactiveScheduleWeekSnapshot,
  putProactiveScheduleWeekSnapshot,
} from "../handlers/proactive-schedule-week-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/snapshot",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getProactiveScheduleWeekSnapshot,
);
router.put(
  "/snapshot",
  validateFirebaseIdToken,
  validateBusinessAccess,
  putProactiveScheduleWeekSnapshot,
);

export default router;
