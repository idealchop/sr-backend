import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { sendTutorialPublishedOwnerEmail } from "../notifications/tutorial-published-owner-email-service";

const SMARTREFILL_APP_ID = "smartrefill";
const NOTICE_COLLECTION = "training_video_publish_notices";
const FANOUT_CONCURRENCY = 25;

export type NotifyTutorialPublishedInput = {
  videoId: string;
  name: string;
  appId?: string | null;
  appPages?: string[] | null;
};

export type NotifyTutorialPublishedResult = {
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

function isSmartrefillTutorial(appId: string | null | undefined): boolean {
  const id = String(appId || "").trim().toLowerCase();
  return !id || id === SMARTREFILL_APP_ID;
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
 * Sales Portal publishes a SmartRefill tutorial video. Idempotent per videoId.
 */
export async function notifyOwnersTutorialPublished(
  input: NotifyTutorialPublishedInput,
): Promise<NotifyTutorialPublishedResult> {
  const videoId = String(input.videoId || "").trim();
  const name = String(input.name || "").trim() || "Untitled tutorial";
  if (!videoId) {
    throw new Error("VIDEO_ID_REQUIRED");
  }

  if (!isSmartrefillTutorial(input.appId)) {
    return {
      notified: false,
      alreadyNotified: false,
      skipped: true,
      ownersNotified: 0,
      emailsSent: 0,
      businessesScanned: 0,
    };
  }

  const lockRef = noticeRef(videoId);
  try {
    await lockRef.create({
      videoId,
      name,
      appId: SMARTREFILL_APP_ID,
      appPages: Array.isArray(input.appPages) ?
        input.appPages.filter((p) => typeof p === "string") :
        [],
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
    const title = "New tutorial video";
    const message = `${name} is ready to watch in Tutorial videos.`;
    const metadata = {
      kind: "tutorial_published",
      tutorialVideoId: videoId,
      openTutorials: true,
      reviewPath: `/dashboard?tutorial=${encodeURIComponent(videoId)}`,
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
        logger.warn("tutorial publish activity notify failed", {
          businessId,
          ownerId,
          videoId,
          error: err,
        });
      }

      try {
        const sent = await sendTutorialPublishedOwnerEmail({
          businessId,
          businessData: { ...businessData, ownerId },
          tutorialName: name,
          videoId,
        });
        if (sent) emailsSent += 1;
      } catch (err) {
        logger.warn("tutorial publish email notify failed", {
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

    logger.info("tutorial publish notify complete", {
      videoId,
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
