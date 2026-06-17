import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export interface Rider {
  id?: string;
  businessId: string;
  userId: string; // Link to global users
  name: string;
  phone: string;
  photoUrl?: string;
  status: "active" | "inactive";
  vehicle?: string;
  quota?: {
    maxDeliveries: number;
    maxCollections?: number;
    maxContainers: number;
  };
  commission?: {
    amount: number;
    basis: "per_order" | "per_volume";
  };
  currentStats?: {
    deliveriesToday: number;
    containersToday: number;
  };
  createdAt?: any;
  updatedAt?: any;
}

export class RiderService {
  /**
   * Adds a new rider to a business.
   * @param {string} businessId The business ID.
   * @param {Partial<Rider>} rider The rider data.
   */
  static async addRider(
    businessId: string,
    rider: Partial<Rider>,
  ): Promise<Rider> {
    try {
      const newRider: Rider = {
        businessId,
        userId: rider.userId || "",
        name: rider.name || "",
        phone: rider.phone || "",
        status: rider.status || "active",
        vehicle: rider.vehicle || "",
        quota: rider.quota || { maxDeliveries: 20, maxContainers: 100 },
        currentStats: { deliveriesToday: 0, containersToday: 0 },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const docRef = await db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .add(newRider);
      return { id: docRef.id, ...newRider };
    } catch (error) {
      logger.error("Error adding rider", error);
      throw error;
    }
  }

  /**
   * Updates a rider.
   * @param {string} businessId The business ID.
   * @param {string} riderId The rider ID.
   * @param {Partial<Rider>} updates The updates.
   */
  static async updateRider(
    businessId: string,
    riderId: string,
    updates: Partial<Rider>,
  ): Promise<void> {
    try {
      const docRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .doc(riderId);
      await docRef.update({
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error(`Error updating rider ${riderId}`, error);
      throw error;
    }
  }

  /**
   * Deletes a rider.
   * @param {string} businessId The business ID.
   * @param {string} riderId The rider ID.
   */
  static async deleteRider(businessId: string, riderId: string): Promise<void> {
    try {
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .doc(riderId)
        .delete();
    } catch (error) {
      logger.error(`Error deleting rider ${riderId}`, error);
      throw error;
    }
  }

  /**
   * Gets all riders for a business.
   * @param {string} businessId The business ID.
   */
  static async getRidersByBusiness(businessId: string): Promise<Rider[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .get();
      return snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        ...doc.data(),
        id: doc.id,
      })) as Rider[];
    } catch (error) {
      logger.error(`Error fetching riders for business ${businessId}`, error);
      throw error;
    }
  }

  /**
   * Resolve a riders subcollection document id + display name.
   * Accepts either a rider doc id or the linked Firebase Auth `userId`.
   * @param {string} businessId The business ID.
   * @param {string} riderIdOrUserId Rider doc id or auth user id (optional).
   * @return {Promise<Object|null>} Resolved rider ref or null.
   */
  static async resolveRiderDocumentId(
    businessId: string,
    riderIdOrUserId: string | undefined | null,
  ): Promise<{ riderId: string; riderName: string } | null> {
    if (!riderIdOrUserId) return null;
    try {
      const byDocId = await RiderService.getRider(businessId, riderIdOrUserId);
      if (byDocId?.id && byDocId.name) {
        return { riderId: byDocId.id, riderName: byDocId.name };
      }
      const byUserId = await RiderService.getRiderByUserId(
        businessId,
        riderIdOrUserId,
      );
      if (byUserId?.id && byUserId.name) {
        return { riderId: byUserId.id, riderName: byUserId.name };
      }
    } catch (error) {
      logger.warn("resolveRiderDocumentId failed", {
        businessId,
        riderIdOrUserId,
        error,
      });
    }
    return null;
  }

  /**
   * Gets a single rider.
   * @param {string} businessId The business ID.
   * @param {string} riderId The rider ID.
   */
  static async getRider(
    businessId: string,
    riderId: string,
  ): Promise<Rider | null> {
    try {
      const doc = await db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .doc(riderId)
        .get();
      if (!doc.exists) return null;
      return { ...doc.data(), id: doc.id } as Rider;
    } catch (error) {
      logger.error(`Error getting rider ${riderId}`, error);
      throw error;
    }
  }

  // eslint-disable-next-line valid-jsdoc
  // eslint-disable-next-line valid-jsdoc
  /**
   * Finds the rider profile linked to a Firebase Auth user (at most one expected).
   */
  static async getRiderByUserId(
    businessId: string,
    userId: string,
  ): Promise<Rider | null> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("riders")
        .where("userId", "==", userId)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { ...doc.data(), id: doc.id } as Rider;
    } catch (error) {
      logger.error(`Error fetching rider by userId for ${userId}`, error);
      throw error;
    }
  }
}
