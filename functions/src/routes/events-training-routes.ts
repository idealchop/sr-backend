import express from "express";
import { rateLimit } from "express-rate-limit";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { rateLimitKeyForRequest } from "../config/rate-limit-keys";
import {
  getOpsEngagementQuestions,
  getOpsWebinarInsights,
  getTutorialPublishNotice,
  postAnswerVideoEngagementPost,
  postNotifyResourcesVideoPublished,
  postNotifyTutorialPublished,
  postNotifyWebinarPublished,
  postOpsWebinarAttendance,
} from "../handlers/events-training-ops-handler";
import {
  getMemberVideoEngagement,
  getMemberVideoPosts,
  getMemberVideoUnlock,
  getMemberVideos,
  getMemberWebinarUnlock,
  getMemberWebinars,
  getMemberBlogEngagement,
  getMemberBlogPosts,
  getMemberBlogById,
  getMemberBlogUnlock,
  getMemberBlogs,
  getWebinarCertificatePdf,
  postCancelWebinar,
  postClaimWebinarCertificate,
  postJoinWebinar,
  postMemberBlogLike,
  postMemberBlogPost,
  postMemberBlogUnlockCheckout,
  postMemberVideoLike,
  postMemberVideoPost,
  postMemberVideoUnlockCheckout,
  postMemberVideoWatch,
  postMemberWebinarUnlockCheckout,
  postRegisterWebinar,
  putMemberVideoNote,
} from "../handlers/events-training-member-handler";

const router = express.Router(); // eslint-disable-line new-cap

/** Stricter per-user caps for write-heavy member engagement actions. */
const engagementWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyForRequest,
  message: { error: "Too many engagement actions. Try again shortly." },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyForRequest,
  message: { error: "Too many registration attempts. Try again shortly." },
});

router.use(validateFirebaseIdToken);

/** Member hub — lean catalog + registration (no idle listeners on FE). */
router.get("/webinars", getMemberWebinars);
router.get("/videos", getMemberVideos);
router.get("/videos/:videoId/engagement", getMemberVideoEngagement);
router.get("/videos/:videoId/posts", getMemberVideoPosts);
router.post("/videos/:videoId/like", engagementWriteLimiter, postMemberVideoLike);
router.post("/videos/:videoId/posts", engagementWriteLimiter, postMemberVideoPost);
router.put("/videos/:videoId/notes", engagementWriteLimiter, putMemberVideoNote);
router.post("/videos/:videoId/watch", engagementWriteLimiter, postMemberVideoWatch);
router.get("/videos/:videoId/unlock", getMemberVideoUnlock);
router.post("/videos/:videoId/unlock-checkout", postMemberVideoUnlockCheckout);
router.get("/blogs", getMemberBlogs);
router.get("/blogs/:articleId/engagement", getMemberBlogEngagement);
router.get("/blogs/:articleId/posts", getMemberBlogPosts);
router.get("/blogs/:articleId/unlock", getMemberBlogUnlock);
router.post("/blogs/:articleId/unlock-checkout", postMemberBlogUnlockCheckout);
router.get("/blogs/:articleId", getMemberBlogById);
router.post("/blogs/:articleId/like", engagementWriteLimiter, postMemberBlogLike);
router.post("/blogs/:articleId/posts", engagementWriteLimiter, postMemberBlogPost);
router.get("/webinars/:eventId/unlock", getMemberWebinarUnlock);
router.post("/webinars/:eventId/unlock-checkout", postMemberWebinarUnlockCheckout);
router.post("/webinars/:eventId/register", registerLimiter, postRegisterWebinar);
router.post("/webinars/:eventId/cancel", registerLimiter, postCancelWebinar);
router.post("/webinars/:eventId/join", registerLimiter, postJoinWebinar);
router.get("/webinars/:eventId/certificate", getWebinarCertificatePdf);
router.post(
  "/webinars/:eventId/certificate",
  registerLimiter,
  postClaimWebinarCertificate,
);

/** Sales Portal ops notify fan-out + questions inbox + insights. */
router.get("/ops/tutorial-publish-notice/:videoId", getTutorialPublishNotice);
router.get("/ops/questions", getOpsEngagementQuestions);
router.get("/ops/insights", getOpsWebinarInsights);
router.post("/ops/notify-tutorial-published", postNotifyTutorialPublished);
router.post("/ops/notify-webinar-published", postNotifyWebinarPublished);
router.post("/ops/notify-resources-video-published", postNotifyResourcesVideoPublished);
router.post(
  "/ops/videos/:videoId/posts/:postId/answer",
  postAnswerVideoEngagementPost,
);
router.post(
  "/ops/registrations/:registrationId/attendance",
  postOpsWebinarAttendance,
);

export default router;
