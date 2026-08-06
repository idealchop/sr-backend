import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { formatPhilippineDateTime } from "../../utils/philippine-datetime";
import { logger } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { webinarsCollection } from "./events-training-collections";
import {
  isRegistrationOpen,
  toIsoTimestamp,
} from "./webinar-registration-window";

const FANOUT_CONCURRENCY = 25;

export type NotifyRegistrationOpenResult = {
  notified: boolean;
  alreadyNotified: boolean;
  skipped: boolean;
  ownersNotified: number;
  businessesScanned: number;
};

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
 * Fans out when registration becomes available.
 * Idempotent via `registrationOpenNotifiedAt` on the event doc.
 */
export async function notifyOwnersWebinarRegistrationOpen(
  eventId: string,
): Promise<NotifyRegistrationOpenResult> {
  const id = String(eventId || "").trim();
  if (!id) {
    throw Object.assign(new Error("EVENT_ID_REQUIRED"), { status: 400 });
  }

  const eventRef = webinarsCollection().doc(id);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
  }

  const data = (eventSnap.data() ?? {}) as Record<string, unknown>;
  if (String(data.status ?? "") !== "published") {
    return {
      notified: false,
      alreadyNotified: false,
      skipped: true,
      ownersNotified: 0,
      businessesScanned: 0,
    };
  }

  if (data.registrationOpenNotifiedAt) {
    return {
      notified: false,
      alreadyNotified: true,
      skipped: false,
      ownersNotified: 0,
      businessesScanned: 0,
    };
  }

  if (!isRegistrationOpen(data)) {
    return {
      notified: false,
      alreadyNotified: false,
      skipped: true,
      ownersNotified: 0,
      businessesScanned: 0,
    };
  }

  // Claim notify slot first to avoid double fan-out under concurrency.
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);
      const current = (snap.data() ?? {}) as Record<string, unknown>;
      if (current.registrationOpenNotifiedAt) {
        throw Object.assign(new Error("ALREADY_NOTIFIED"), { code: "ALREADY" });
      }
      if (!isRegistrationOpen(current)) {
        throw Object.assign(new Error("NOT_OPEN"), { code: "SKIP" });
      }
      tx.set(
        eventRef,
        {
          registrationOpenNotifiedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ALREADY") {
      return {
        notified: false,
        alreadyNotified: true,
        skipped: false,
        ownersNotified: 0,
        businessesScanned: 0,
      };
    }
    if (code === "SKIP") {
      return {
        notified: false,
        alreadyNotified: false,
        skipped: true,
        ownersNotified: 0,
        businessesScanned: 0,
      };
    }
    throw error;
  }

  const name = String(data.name ?? "").trim() || "Untitled webinar";
  const startsAt = toIsoTimestamp(data.startsAt);
  const startsLabel =
    startsAt ? formatPhilippineDateTime(startsAt) : "";
  const startsHint =
    startsLabel && startsLabel !== "—" ?
      ` Starts ${startsLabel} (Asia/Manila).` :
      "";

  const businessesSnap = await db.collection("businesses").select("ownerId").get();
  const targets: Array<{ businessId: string; ownerId: string }> = [];
  for (const doc of businessesSnap.docs) {
    const ownerId = String(doc.data()?.ownerId || "").trim();
    if (!ownerId) continue;
    targets.push({ businessId: doc.id, ownerId });
  }

  let ownersNotified = 0;
  const title = "Webinar registration open";
  const message = `${name} is now open for registration.${startsHint}`;
  const metadata = {
    kind: "webinar_registration_open",
    webinarEventId: id,
    reviewPath: "/webinars",
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
      logger.warn("webinar registration-open notify failed for owner", {
        businessId,
        ownerId,
        eventId: id,
        error: err,
      });
    }
  });

  logger.info("webinar registration-open notify complete", {
    eventId: id,
    ownersNotified,
    businessesScanned: businessesSnap.size,
  });

  return {
    notified: true,
    alreadyNotified: false,
    skipped: false,
    ownersNotified,
    businessesScanned: businessesSnap.size,
  };
}

/**
 * Scan published events whose registration window just opened.
 */
export async function notifyDueWebinarRegistrationOpens(
  limit = 20,
): Promise<{ eventsScanned: number; notified: number }> {
  const snap = await webinarsCollection()
    .where("status", "==", "published")
    .limit(120)
    .get();

  let notified = 0;
  let scanned = 0;
  for (const doc of snap.docs) {
    if (scanned >= limit) break;
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    if (data.registrationOpenNotifiedAt) continue;
    if (!isRegistrationOpen(data)) continue;
    scanned += 1;
    try {
      const result = await notifyOwnersWebinarRegistrationOpen(doc.id);
      if (result.notified) notified += 1;
    } catch (err) {
      logger.warn("registration-open notify failed", {
        eventId: doc.id,
        error: err,
      });
    }
  }

  return { eventsScanned: scanned, notified };
}
