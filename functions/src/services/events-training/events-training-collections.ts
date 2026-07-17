import { db } from "../../config/firebase-admin";

export const EVENTS_TRAINING_APP_ID = "smartrefill";

export const EVENTS_TRAINING_COLLECTIONS = {
  webinarEvents: "webinar_events",
  trainingVideos: "training_videos",
  webinarRegistrations: "webinar_registrations",
  /** Sales Portal WRS Blog CMS articles. */
  wrsBlogs: "wrs_blogs",
  /** Member likes / comments / questions (separate from CMS video docs). */
  trainingVideoEngagement: "training_video_engagement",
  /** Member likes / comments on WRS Blog articles (keyed by blog doc id). */
  blogEngagement: "blog_engagement",
} as const;

export function eventsTrainingRoot() {
  return db.collection("apps").doc(EVENTS_TRAINING_APP_ID);
}

export function webinarsCollection() {
  return eventsTrainingRoot().collection(
    EVENTS_TRAINING_COLLECTIONS.webinarEvents,
  );
}

export function trainingVideosCollection() {
  return eventsTrainingRoot().collection(
    EVENTS_TRAINING_COLLECTIONS.trainingVideos,
  );
}

export function webinarRegistrationsCollection() {
  return eventsTrainingRoot().collection(
    EVENTS_TRAINING_COLLECTIONS.webinarRegistrations,
  );
}

export function wrsBlogsCollection() {
  return eventsTrainingRoot().collection(EVENTS_TRAINING_COLLECTIONS.wrsBlogs);
}
