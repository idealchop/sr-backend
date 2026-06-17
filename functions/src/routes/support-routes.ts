import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware"; import {
  getSupportSession,
  getSupportSessionById,
  postSupportEscalate,
  postSupportFeedback,
  postSupportMessage,
  postSupportNewSession,
  postSupportPresenceAck,
  postSupportPresenceEnd,
  postSupportResolve,
  postSupportSatisfaction,
} from "../handlers/support-chat-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/session",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getSupportSession,
);

router.get(
  "/session/:sessionId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getSupportSessionById,
);

router.post(
  "/session/messages",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportMessage,
);

router.post(
  "/session/satisfaction",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportSatisfaction,
);

router.post(
  "/session/escalate",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportEscalate,
);

router.post(
  "/session/presence/ack",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportPresenceAck,
);

router.post(
  "/session/presence/end",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportPresenceEnd,
);

router.post(
  "/session/feedback",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportFeedback,
);

router.post(
  "/session/resolve",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportResolve,
);

router.post(
  "/session/new",
  validateFirebaseIdToken,
  validateBusinessAccess,
  postSupportNewSession,
);

export default router;
