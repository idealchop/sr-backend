import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";

/**
 * Lists notifications for the authenticated user.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listMyNotifications = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { businessId } = req.query;

  if (!user?.uid || !businessId) {
    res.status(400).json({ error: "User ID and Business ID are required" });
    return;
  }

  try {
    const snapshot = await db
      .collection("businesses")
      .doc(businessId as string)
      .collection("notifications")
      .where("userId", "==", user.uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const notifications = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
      };
    });

    res.json({ data: notifications });
  } catch (error: any) {
    logger.error("Error listing notifications", { error, userId: user.uid });
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
      code: error.code,
    });
  }
};

/**
 * Marks one or more notifications as read.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const markAsRead = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { notificationId } = req.params;
  const { notificationIds, businessId } = req.body;

  const idsToUpdate: string[] =
    notificationIds || (notificationId ? [notificationId] : []);

  if (idsToUpdate.length === 0 || !businessId) {
    res
      .status(400)
      .json({ error: "Notification ID(s) and Business ID are required" });
    return;
  }

  try {
    const batch = db.batch();
    let updatedCount = 0;

    const snapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("notifications")
      .where("userId", "==", user.uid)
      .where("__name__", "in", idsToUpdate)
      .get();

    if (snapshot.empty) {
      res.status(404).json({ error: "No matching notifications found" });
      return;
    }

    snapshot.docs.forEach((doc: any) => {
      batch.update(doc.ref, {
        status: "read",
        readAt: FieldValue.serverTimestamp(),
      });
      updatedCount++;
    });

    await batch.commit();

    res.json({ success: true, count: updatedCount });
  } catch (error) {
    logger.error("Error marking notifications as read", {
      error,
      ids: idsToUpdate,
      userId: user.uid,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
};
