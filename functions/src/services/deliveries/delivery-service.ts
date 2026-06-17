import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { TransactionService } from "../transactions/transaction-service";

export interface ContainerMovement {
  itemId: string;
  qtyDelivered: number;
  qtyCollected: number;
}

export interface Delivery {
  id?: string;
  businessId: string;
  transactionId: string;
  customerId: string;
  riderId?: string;
  status:
    | "pending"
    | "assigned"
    | "picked-up"
    | "delivered"
    | "collected"
    | "failed";
  items: Array<{ waterTypeId: string; quantity: number }>;
  containerMovements: ContainerMovement[];
  notes?: string;
  location: {
    address: string;
    lat: number;
    lng: number;
  };
  signatureUrl?: string;
  assignedAt?: any;
  completedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export class DeliveryService {
  /**
   * Creates a new delivery record.
   * @param {string} businessId The business ID.
   * @param {Partial<Delivery>} delivery The delivery data.
   */
  static async createDelivery(
    businessId: string,
    delivery: Partial<Delivery>,
  ): Promise<Delivery> {
    try {
      const newDelivery: Delivery = {
        businessId,
        transactionId: delivery.transactionId || "",
        customerId: delivery.customerId || "",
        riderId: delivery.riderId,
        status: delivery.status || "pending",
        items: delivery.items || [],
        containerMovements: delivery.containerMovements || [],
        notes: delivery.notes || "",
        location: delivery.location || { address: "", lat: 0, lng: 0 },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const docRef = await db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .add(newDelivery);
      return { id: docRef.id, ...newDelivery };
    } catch (error) {
      logger.error("Error creating delivery", error);
      throw error;
    }
  }

  /**
   * Assigns a rider to a delivery.
   * @param {string} businessId The business ID.
   * @param {string} deliveryId The delivery ID.
   * @param {string} riderId The rider ID.
   */
  static async assignRider(
    businessId: string,
    deliveryId: string,
    riderId: string,
  ): Promise<void> {
    try {
      const deliveryRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .doc(deliveryId);

      const doc = await deliveryRef.get();
      if (!doc.exists) throw new Error("Delivery not found");
      const delivery = doc.data() as Delivery;

      await deliveryRef.update({
        riderId,
        status: "assigned",
        assignedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Log the assignment
      await logAuditEvent(
        "RIDER_ASSIGNED",
        { businessId, riderId, deliveryId },
        null,
        { riderId },
        delivery.transactionId,
      );
    } catch (error) {
      logger.error(`Error assigning rider to delivery ${deliveryId}`, error);
      throw error;
    }
  }

  /**
   * Completes a delivery.
   * @param {string} businessId The business ID.
   * @param {string} deliveryId The delivery ID.
   * @param {ContainerMovement[]} movements The container movements.
   * @param {string} signatureUrl The signature URL.
   */
  static async completeDelivery(
    businessId: string,
    deliveryId: string,
    movements: ContainerMovement[],
    signatureUrl?: string,
  ): Promise<void> {
    try {
      const deliveryRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .doc(deliveryId);

      const deliveryDoc = await deliveryRef.get();
      if (!deliveryDoc.exists) {
        throw new Error("Delivery not found");
      }

      const deliveryData = deliveryDoc.data() as Delivery;

      await deliveryRef.update({
        status: "delivered",
        containerMovements: movements,
        signatureUrl: signatureUrl || null,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Synchronize with Transaction
      if (deliveryData.transactionId) {
        await TransactionService.updateTransaction(
          businessId,
          deliveryData.transactionId,
          {
            deliveryStatus: "completed",
            signatureUrl: signatureUrl || undefined,
            deliveredAt: FieldValue.serverTimestamp() as any,
          },
        );

        // Specific audit for delivery completion
        await logAuditEvent(
          "DELIVERY_COMPLETED",
          { businessId, deliveryId, signatureUrl },
          null,
          { status: "delivered", movements },
          deliveryData.transactionId,
        );
      }
    } catch (error) {
      logger.error(`Error completing delivery ${deliveryId}`, error);
      throw error;
    }
  }

  /**
   * Gets ALL deliveries for a business (full history).
   * @param {string} businessId The business ID.
   */
  static async getAllDeliveries(businessId: string): Promise<Delivery[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .orderBy("createdAt", "desc")
        .get();
      return snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        id: doc.id,
        ...doc.data(),
      })) as Delivery[];
    } catch (error) {
      logger.error(
        `Error fetching all deliveries for business ${businessId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Gets active deliveries for a business.
   * @param {string} businessId The business ID.
   */
  static async getActiveDeliveries(businessId: string): Promise<Delivery[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .where("status", "in", ["pending", "assigned", "picked-up"])
        .get();
      return snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        id: doc.id,
        ...doc.data(),
      })) as Delivery[];
    } catch (error) {
      logger.error(
        `Error fetching active deliveries for business ${businessId}`,
        error,
      );
      throw error;
    }
  }
  /**
   * Gets a single delivery record.
   * @param {string} businessId The business ID.
   * @param {string} deliveryId The delivery ID.
   */
  static async getDelivery(
    businessId: string,
    deliveryId: string,
  ): Promise<Delivery | null> {
    try {
      const doc = await db
        .collection("businesses")
        .doc(businessId)
        .collection("deliveries")
        .doc(deliveryId)
        .get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Delivery;
    } catch (error) {
      logger.error(`Error getting delivery ${deliveryId}`, error);
      throw error;
    }
  }
}
