import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export interface RiderLastLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface RiderLocationInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
}

/**
 * Persists live GPS for a rider (`businesses/{id}/riders/{riderId}.lastLocation`).
 */
export class RiderTrackingService {
  static async updateRiderLocation(
    businessId: string,
    riderId: string,
    actorUid: string,
    businessRole: string,
    location: RiderLocationInput,
  ): Promise<RiderLastLocation> {
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("INVALID_COORDINATES");
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("INVALID_COORDINATES");
    }

    const riderRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("riders")
      .doc(riderId);
    const riderSnap = await riderRef.get();
    if (!riderSnap.exists) {
      throw new Error("RIDER_NOT_FOUND");
    }
    const rider = riderSnap.data() || {};
    const riderUserId = String(rider.userId || "").trim();
    const isOwner = businessRole === "owner";
    const isAdmin = businessRole === "admin";
    const isSelf = riderUserId && riderUserId === actorUid;
    if (!isOwner && !isAdmin && !isSelf) {
      throw new Error("FORBIDDEN");
    }

    const lastLocation: Record<string, unknown> = {
      latitude: lat,
      longitude: lng,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (location.accuracy != null && Number.isFinite(location.accuracy)) {
      lastLocation.accuracy = location.accuracy;
    }
    if (location.heading != null && Number.isFinite(location.heading)) {
      lastLocation.heading = location.heading;
    }

    await riderRef.set(
      { lastLocation, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    const updated = await riderRef.get();
    const stored = updated.data()?.lastLocation as RiderLastLocation | undefined;
    if (!stored?.latitude || !stored?.longitude) {
      return {
        latitude: lat,
        longitude: lng,
        updatedAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
      };
    }
    return stored;
  }

  static async getRiderLastLocation(
    businessId: string,
    riderId: string,
  ): Promise<RiderLastLocation | null> {
    try {
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
      return loc as RiderLastLocation;
    } catch (error) {
      logger.error("getRiderLastLocation failed", error);
      return null;
    }
  }
}
