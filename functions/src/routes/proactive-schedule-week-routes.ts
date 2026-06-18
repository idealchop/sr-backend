import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware"; import {
  getProactiveScheduleWeekSnapshot,
  putProactiveScheduleWeekSnapshot,
} from "../handlers/proactive-schedule-week-handler";
import { postProactiveWeekAiGenerate } from "../handlers/proactive-week-ai-handler";

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
router.post(
  "/generate-ai",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postProactiveWeekAiGenerate,
);

export default router;
