import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { postWhatsNewSync } from "../handlers/whats-new-handler";

const router = express.Router(); // eslint-disable-line new-cap

router.post("/whats-new/sync", validateFirebaseIdToken, postWhatsNewSync);

export default router;
