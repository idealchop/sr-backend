import { db, FieldValue } from "../../config/firebase-admin";
import { PHILIPPINE_TIMEZONE } from "../../utils/philippine-datetime";

const WALKIN_QUEUE_COUNTER_ID = "walkinQueue";

/**
 * Manila calendar day key (`YYYYMMDD`) for daily queue reset.
 * @param {Date} [now] Reference time (defaults to current instant).
 * @return {string} Date key in `YYYYMMDD` format for Asia/Manila.
 */
export function manilaWalkInQueueDateKey(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PHILIPPINE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}${m}${d}`;
}

/**
 * Allocates the next walk-in queue number for the station (resets each Manila day).
 * Used by the counter QR portal when a customer taps Send to counter.
 * @param {string} businessId Workspace id.
 * @param {Date} [now] Reference time for the Manila date key (defaults to current instant).
 * @return {Promise<{queueNumber: number, queueDate: string}>} Assigned queue number and date key.
 */
export async function allocateWalkInQueueNumber(
  businessId: string,
  now = new Date(),
): Promise<{ queueNumber: number; queueDate: string }> {
  const queueDate = manilaWalkInQueueDateKey(now);
  const counterRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("counters")
    .doc(WALKIN_QUEUE_COUNTER_ID);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() as
      | { dateKey?: string; nextNumber?: number }
      | undefined;

    let queueNumber = 1;
    if (
      data?.dateKey === queueDate &&
      typeof data.nextNumber === "number" &&
      data.nextNumber >= 1
    ) {
      queueNumber = data.nextNumber;
    }

    tx.set(
      counterRef,
      {
        dateKey: queueDate,
        nextNumber: queueNumber + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { queueNumber, queueDate };
  });
}
