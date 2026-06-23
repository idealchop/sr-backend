import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";

export const PORTAL_TRACK_LIVE_SUBCOLLECTION = "portal_track_live";

function liveDocRef(businessId: string, referenceId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection(PORTAL_TRACK_LIVE_SUBCOLLECTION)
    .doc(referenceId);
}

async function readRiderLastCoordinates(
  businessId: string,
  riderId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("riders")
    .doc(riderId)
    .get();
  const loc = snap.data()?.lastLocation;
  if (
    !loc ||
    typeof loc.latitude !== "number" ||
    typeof loc.longitude !== "number"
  ) {
    return null;
  }
  return { latitude: loc.latitude, longitude: loc.longitude };
}

/**
 * Public-safe rider pin for portal track — lat/lng only, keyed by order referenceId.
 * Clients listen with Firestore onSnapshot (no custom WebSocket).
 */
export async function upsertPortalTrackLiveForRider(
  businessId: string,
  riderId: string,
  location: { latitude: number; longitude: number },
): Promise<void> {
  const txsSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("riderId", "==", riderId)
    .where("deliveryStatus", "==", "in-transit")
    .get();

  if (txsSnap.empty) return;

  const batch = db.batch();
  let writes = 0;

  for (const txDoc of txsSnap.docs) {
    const refId = String(txDoc.data().referenceId || "").trim();
    if (!refId) continue;
    batch.set(
      liveDocRef(businessId, refId),
      {
        referenceId: refId,
        businessId,
        riderId,
        latitude: location.latitude,
        longitude: location.longitude,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }
}

export async function clearPortalTrackLive(
  businessId: string,
  referenceId: string,
): Promise<void> {
  const refId = referenceId.trim();
  if (!refId) return;
  try {
    await liveDocRef(businessId, refId).delete();
  } catch (error) {
    logger.warn("clearPortalTrackLive failed", { businessId, referenceId: refId, error });
  }
}

/** Seed or remove live doc when delivery status changes. */
export async function syncPortalTrackLiveOnDeliveryStatus(
  businessId: string,
  input: {
    referenceId?: string | null;
    riderId?: string | null;
    deliveryStatus?: string | null;
  },
): Promise<void> {
  const referenceId = String(input.referenceId || "").trim();
  if (!referenceId) return;

  const status = String(input.deliveryStatus || "").toLowerCase();
  if (status === "in-transit") {
    const riderId = String(input.riderId || "").trim();
    if (!riderId) return;

    const loc = await readRiderLastCoordinates(businessId, riderId);
    if (
      !loc
    ) {
      await liveDocRef(businessId, referenceId).set(
        {
          referenceId,
          businessId,
          riderId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    await liveDocRef(businessId, referenceId).set(
      {
        referenceId,
        businessId,
        riderId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  await clearPortalTrackLive(businessId, referenceId);
}
