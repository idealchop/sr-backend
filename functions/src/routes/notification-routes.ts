import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  listMyNotifications,
  markAsRead,
} from "../handlers/notification-handler";

const router = express.Router(); // eslint-disable-line new-cap

// All notification routes require authentication
router.use(validateFirebaseIdToken);

router.get("/", listMyNotifications);
router.put("/read", markAsRead); // Bulk read via body
router.put("/:notificationId/read", markAsRead); // Single read via URL

export default router;
