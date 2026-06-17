import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export interface NotificationPayload {
  userId: string;
  businessId?: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success" | "error";
  metadata?: Record<string, any>;
}

/**
 * Service for managing user and business notifications.
 */
export class NotificationService {
  /**
   * Sends a notification to a specific user.
   * Note: This event is logged to the audit trail with 'notification' type.
   * @param {NotificationPayload} payload The notification data.
   * @return {Promise<{success: boolean, id: string}>} The result of the operation.
   */
  static async send(payload: NotificationPayload) {
    try {
      const businessId = payload.businessId;
      const targetCollection = businessId ?
        db
          .collection("businesses")
          .doc(businessId)
          .collection("notifications") :
        db.collection("notifications");

      const notificationRef = targetCollection.doc();

      const notificationData = {
        ...payload,
        status: "unread",
        createdAt: FieldValue.serverTimestamp(),
      };

      await notificationRef.set(notificationData);

      return { success: true, id: notificationRef.id };
    } catch (error) {
      logger.error("Failed to send notification", {
        error,
        recipientId: payload.userId,
        title: payload.title,
      });
      throw error;
    }
  }

  /**
   * Broadcasts a notification to all members of a business.
   * @param {string} businessId The business ID.
   * @param {Omit<NotificationPayload, "userId">} payload The notification data.
   * @return {Promise<void>}
   */
  static async broadcastToBusiness(
    businessId: string,
    payload: Omit<NotificationPayload, "userId">,
  ) {
    try {
      const membersSnapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("members")
        .get();

      const promises = membersSnapshot.docs.map((doc: QueryDocumentSnapshot) =>
        this.send({
          ...payload,
          userId: doc.id, // Assuming doc ID is the userId
          businessId,
        }),
      );

      await Promise.all(promises);
    } catch (error) {
      logger.error(`Failed to broadcast to business ${businessId}`, { error });
      throw error;
    }
  }
}
