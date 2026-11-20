import { db } from "../../config/firebase-admin";

/** Delivery statuses that count as an "active stop" on the public track page. */
export const RIDER_ACTIVE_STOP_STATUSES = ["pending", "placed", "in-transit"] as const;

/** Display cap: the track page only needs "N other stops", never the full history. */
export const RIDER_OTHER_ACTIVE_STOPS_CAP = 50;

/**
 * Other active stops assigned to the same rider (excludes current transaction).
 *
 * Read-cost: filtered + capped query (`riderId ==`, `deliveryStatus in`, limit)
 * instead of reading every stop the rider has ever had. Uses the
 * `transactions(riderId, deliveryStatus)` composite index.
 * @param {string} businessId Business tenant id.
 * @param {string} riderId Rider document id.
 * @param {string} excludeTxId Transaction to exclude from the count.
 * @return {Promise<number>} Count of other active stops, capped at 50.
 */
export async function countRiderOtherActiveStops(
  businessId: string,
  riderId: string,
  excludeTxId: string,
): Promise<number> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("riderId", "==", riderId)
    .where("deliveryStatus", "in", [...RIDER_ACTIVE_STOP_STATUSES])
    // +1 so excluding the current stop still leaves up to the full cap.
    .limit(RIDER_OTHER_ACTIVE_STOPS_CAP + 1)
    .get();
  const others = snap.docs.filter((doc) => doc.id !== excludeTxId).length;
  return Math.min(others, RIDER_OTHER_ACTIVE_STOPS_CAP);
}
