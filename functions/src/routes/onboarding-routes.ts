import express from "express";
import { completeOnboarding } from "../handlers/onboarding-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.post("/complete", validateFirebaseIdToken, completeOnboarding);

export default router;
