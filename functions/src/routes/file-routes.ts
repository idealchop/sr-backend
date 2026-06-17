import express from "express";
import { uploadFile } from "../handlers/file-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { rateLimit } from "express-rate-limit";

const router = express.Router(); // eslint-disable-line new-cap

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50, // 50 uploads per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many uploads, please try again later",
  skip: () => !!process.env.FUNCTIONS_EMULATOR,
});

router.post("/upload", validateFirebaseIdToken, uploadLimiter, uploadFile);

export default router;
