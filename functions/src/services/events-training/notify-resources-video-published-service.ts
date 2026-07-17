import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { sendResourcesVideoPublishedOwnerEmail } from "../notifications/resources-video-published-owner-email-service";

const SMARTREFILL_APP_ID = "smartrefill";
/** Shared idempotency collection with tutorial publish notices (keyed by videoId). */
const NOTICE_COLLECTION = "training_video_publish_notices";
const FANOUT_CONCURRENCY = 25;

export type ResourcesVideoCategory = "wrs_stories" | "webinar";

export type NotifyResourcesVideoPublishedInput = {
  videoId: string;
  name: string;
  category: ResourcesVideoCategory;
};

export type NotifyResourcesVideoPublishedResult = {
  notified: boolean;
  alreadyNotified: boolean;
  skipped: boolean;
  ownersNotified: number;
  emailsSent: number;
  businessesScanned: number;
};

function noticeRef(videoId: string) {
  return db
    .collection("apps")
    .doc(SMARTREFILL_APP_ID)
    .collection(NOTICE_COLLECTION)
    .doc(videoId);
}

function categoryCopy(category: ResourcesVideoCategory): {
  title: string;
  messageSuffix: string;
  kind: string;
} {
  if (category === "webinar") {
    return {
      title: "New webinar recording",
      messageSuffix: "is ready to watch in Resources · Webinars.",
      kind: "webinar_recording_published",
    };
  }
  return {
    title: "New WRS Story",
    messageSuffix: "is ready to watch in Resources · WRS Stories.",
    kind: "wrs_story_published",
  };
}

function reviewPathFor(category: ResourcesVideoCategory, videoId: string): string {
  if (category === "webinar") {
    return `/resources/webinars?video=${encodeURIComponent(videoId)}`;
  }
  return `/resources/wrs-stories?video=${encodeURIComponent(videoId)}`;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Fans out activity-feed + email notifications to each station owner when
 * Sales Portal publishes a WRS Story or webinar recording. Idempotent per videoId.
 */
export async function notifyOwnersResourcesVideoPublished(
  input: NotifyResourcesVideoPublishedInput,
): Promise<NotifyResourcesVideoPublishedResult> {
  const videoId = String(input.videoId || "").trim();
  const name = String(input.name || "").trim() || "Untitled video";
  const category =
    input.category === "webinar" ? "webinar" : "wrs_stories";
  if (!videoId) {
    throw new Error("VIDEO_ID_REQUIRED");
  }

  const copy = categoryCopy(category);
  const reviewPath = reviewPathFor(category, videoId);

  const lockRef = noticeRef(videoId);
  try {
    await lockRef.create({
      videoId,
      name,
      category,
      kind: copy.kind,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 6 || code === "already-exists") {
      return {
        notified: false,
        alreadyNotified: true,
        skipped: false,
        ownersNotified: 0,
        emailsSent: 0,
        businessesScanned: 0,
      };
    }
    throw error;
  }

  try {
    const businessesSnap = await db
      .collection("businesses")
      .select("ownerId", "email", "name")
      .get();

    const targets: Array<{
      businessId: string;
      ownerId: string;
      businessData: Record<string, unknown>;
    }> = [];
    for (const doc of businessesSnap.docs) {
      const data = doc.data() ?? {};
      const ownerId = String(data.ownerId || "").trim();
      if (!ownerId) continue;
      targets.push({
        businessId: doc.id,
        ownerId,
        businessData: data,
      });
    }

    let ownersNotified = 0;
    let emailsSent = 0;
    const title = copy.title;
    const message = `${name} ${copy.messageSuffix}`;
    const metadata = {
      kind: copy.kind,
      trainingVideoId: videoId,
      category,
      reviewPath,
    };

    await mapPool(targets, FANOUT_CONCURRENCY, async ({
      businessId,
      ownerId,
      businessData,
    }) => {
      try {
        await NotificationService.send({
          userId: ownerId,
          businessId,
          title,
          message,
          type: "info",
          metadata,
        });
        ownersNotified += 1;
      } catch (err) {
        logger.warn("resources video publish activity notify failed", {
          businessId,
          ownerId,
          videoId,
          error: err,
        });
      }

      try {
        const sent = await sendResourcesVideoPublishedOwnerEmail({
          businessId,
          businessData: { ...businessData, ownerId },
          videoName: name,
          videoId,
          category,
          reviewPath,
        });
        if (sent) emailsSent += 1;
      } catch (err) {
        logger.warn("resources video publish email notify failed", {
          businessId,
          ownerId,
          videoId,
          error: err,
        });
      }
    });

    await lockRef.set(
      {
        status: "sent",
        ownersNotified,
        emailsSent,
        businessesScanned: businessesSnap.size,
        notifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info("resources video publish notify complete", {
      videoId,
      category,
      ownersNotified,
      emailsSent,
      businessesScanned: businessesSnap.size,
    });

    return {
      notified: true,
      alreadyNotified: false,
      skipped: false,
      ownersNotified,
      emailsSent,
      businessesScanned: businessesSnap.size,
    };
  } catch (error) {
    await lockRef.delete().catch(() => undefined);
    throw error;
  }
}
