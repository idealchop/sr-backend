import express from "express";
import {
  getAuthStatus,
  getRegistrationStatus,
  getWorkspaceProfile,
  postRegistrationPreview,
  handleSignup,
  sendVerification,
  recordLoginEvent,
  updateAccount,
  changePassword,
  forgotPassword,
  postCustomToken,
} from "../handlers/auth-handler";
import { postCompleteStaffOnboarding } from "../handlers/team-invite-public-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { rateLimit } from "express-rate-limit";

const router = express.Router(); // eslint-disable-line new-cap

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many authentication attempts, please try again after an hour",
  skip: () => !!process.env.FUNCTIONS_EMULATOR,
});

/** Marketing → product handoff; verifies an existing Firebase ID token. */
const customTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many handoff attempts, please try again later",
  skip: () => !!process.env.FUNCTIONS_EMULATOR || process.env.NODE_ENV === "development",
});

router.get("/status", validateFirebaseIdToken, getAuthStatus);
router.get("/workspace-profile", validateFirebaseIdToken, getWorkspaceProfile);
router.get(
  "/registration-status",
  validateFirebaseIdToken,
  getRegistrationStatus,
);
router.post("/registration-preview", authLimiter, postRegistrationPreview);
router.post("/signup", authLimiter, validateFirebaseIdToken, handleSignup);
router.post(
  "/send-verification",
  authLimiter,
  validateFirebaseIdToken,
  sendVerification,
);
router.post("/login", validateFirebaseIdToken, recordLoginEvent);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/custom-token", customTokenLimiter, postCustomToken);
router.put("/account", validateFirebaseIdToken, updateAccount);
router.put("/change-password", validateFirebaseIdToken, changePassword);
router.post(
  "/staff-onboarding/complete",
  validateFirebaseIdToken,
  postCompleteStaffOnboarding,
);

export default router;
