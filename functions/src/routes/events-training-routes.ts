import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  getTutorialPublishNotice,
  postNotifyTutorialPublished,
  postNotifyWebinarPublished,
} from "../handlers/events-training-ops-handler";

const router = express.Router(); // eslint-disable-line new-cap

router.get(
  "/ops/tutorial-publish-notice/:videoId",
  validateFirebaseIdToken,
  getTutorialPublishNotice,
);
router.post(
  "/ops/notify-tutorial-published",
  validateFirebaseIdToken,
  postNotifyTutorialPublished,
);
router.post(
  "/ops/notify-webinar-published",
  validateFirebaseIdToken,
  postNotifyWebinarPublished,
);

export default router;
