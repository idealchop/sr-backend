import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";

const SMARTREFILL_APP_ID = "smartrefill";
const NOTICE_COLLECTION = "webinar_publish_notices";
const FANOUT_CONCURRENCY = 25;

export type NotifyWebinarPublishedInput = {
  eventId: string;
  name: string;
  startsAt?: string | null;
};

export type NotifyWebinarPublishedResult = {
  notified: boolean;
  alreadyNotified: boolean;
  ownersNotified: number;
  businessesScanned: number;
};

function noticeRef(eventId: string) {
  return db
    .collection("apps")
    .doc(SMARTREFILL_APP_ID)
    .collection(NOTICE_COLLECTION)
    .doc(eventId);
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
 * Fans out an in-app notification to each station owner when Sales Portal
 * publishes a webinar. Idempotent per eventId.
 */
export async function notifyOwnersWebinarPublished(
  input: NotifyWebinarPublishedInput,
): Promise<NotifyWebinarPublishedResult> {
  const eventId = String(input.eventId || "").trim();
  const name = String(input.name || "").trim() || "Untitled webinar";
  if (!eventId) {
    throw new Error("EVENT_ID_REQUIRED");
  }

  const lockRef = noticeRef(eventId);
  try {
    await lockRef.create({
      eventId,
      name,
      startsAt: input.startsAt ?? null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const code = (error as {code?: number | string})?.code;
    if (code === 6 || code === "already-exists") {
      return {
        notified: false,
        alreadyNotified: true,
        ownersNotified: 0,
        businessesScanned: 0,
      };
    }
    throw error;
  }

  try {
    const businessesSnap = await db
      .collection("businesses")
      .select("ownerId")
      .get();

    const targets: Array<{businessId: string; ownerId: string}> = [];
    for (const doc of businessesSnap.docs) {
      const ownerId = String(doc.data()?.ownerId || "").trim();
      if (!ownerId) continue;
      targets.push({ businessId: doc.id, ownerId });
    }

    let ownersNotified = 0;
    const startsHint =
      typeof input.startsAt === "string" && input.startsAt.trim() ?
        ` Starts ${input.startsAt.trim()}.` :
        "";
    const title = "New webinar";
    const message = `${name} is now open for registration.${startsHint}`;
    const metadata = {
      kind: "webinar_published",
      webinarEventId: eventId,
      reviewPath: "/dashboard",
    };

    await mapPool(targets, FANOUT_CONCURRENCY, async ({ businessId, ownerId }) => {
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
        logger.warn("webinar publish notify failed for owner", {
          businessId,
          ownerId,
          eventId,
          error: err,
        });
      }
    });

    await lockRef.set(
      {
        status: "sent",
        ownersNotified,
        businessesScanned: businessesSnap.size,
        notifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info("webinar publish notify complete", {
      eventId,
      ownersNotified,
      businessesScanned: businessesSnap.size,
    });

    return {
      notified: true,
      alreadyNotified: false,
      ownersNotified,
      businessesScanned: businessesSnap.size,
    };
  } catch (error) {
    await lockRef.delete().catch(() => undefined);
    throw error;
  }
}
