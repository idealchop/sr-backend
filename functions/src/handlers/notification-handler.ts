import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";
import { checkBusinessAccess } from "../utils/auth-utils";
import { AlertDeliveryLogService } from "../services/notifications/alert-delivery-log-service";
import {
  AlertDeliveryResendError,
  previewAlertDeliveryLogEntry,
  resendAlertDeliveryLogEntry,
} from "../services/notifications/alert-delivery-resend-service";
import { CustomerService } from "../services/customers/customer-service";

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

  const idsToUpdate: string[] = Array.from(
    new Set(
      (notificationIds || (notificationId ? [notificationId] : []))
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean),
    ),
  );

  if (idsToUpdate.length === 0 || !businessId) {
    res
      .status(400)
      .json({ error: "Notification ID(s) and Business ID are required" });
    return;
  }

  // Firestore `in` supports at most 30 values — clear-all can send up to the list limit (50).
  const FIRESTORE_IN_LIMIT = 30;

  try {
    let updatedCount = 0;
    const notificationsRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("notifications");

    for (let i = 0; i < idsToUpdate.length; i += FIRESTORE_IN_LIMIT) {
      const chunk = idsToUpdate.slice(i, i + FIRESTORE_IN_LIMIT);
      const snapshot = await notificationsRef
        .where("userId", "==", user.uid)
        .where("__name__", "in", chunk)
        .get();

      if (snapshot.empty) continue;

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          status: "read",
          readAt: FieldValue.serverTimestamp(),
        });
        updatedCount++;
      });
      await batch.commit();
    }

    if (updatedCount === 0) {
      res.status(404).json({ error: "No matching notifications found" });
      return;
    }

    res.json({ success: true, count: updatedCount });
  } catch (error) {
    logger.error("Error marking notifications as read", {
      error,
      ids: idsToUpdate,
      userId: user.uid,
    });
    res.status(500).json({
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : undefined,
    });
  }
};

/**
 * NT-75 — recent push/email/SMS delivery outcomes for owner review.
 */
export const listAlertDeliveryLog = async (req: Request, res: Response) => {
  const user = (req as { user?: { uid: string } }).user;
  const businessId = String(req.query.businessId || "").trim();
  const customerId = String(req.query.customerId || "").trim();
  const channelRaw = String(req.query.channel || "").trim();
  const limit = Number(req.query.limit) || 50;

  if (!user?.uid || !businessId) {
    res.status(400).json({ error: "User ID and Business ID are required" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (customerId) {
      const customer = await CustomerService.getCustomer(businessId, customerId);
      if (!customer) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      const txSnap = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", customerId)
        .limit(100)
        .get();
      const referenceIds = txSnap.docs
        .map((doc) => String(doc.data()?.referenceId || "").trim())
        .filter(Boolean);

      const channel =
        channelRaw === "email" || channelRaw === "sms" || channelRaw === "push" ?
          channelRaw :
          "email";

      const data = await AlertDeliveryLogService.listForCustomer(
        businessId,
        customerId,
        {
          limit,
          channel,
          audience: "customer",
          customerEmail: customer.email,
          referenceIds,
        },
      );
      res.json({ data });
      return;
    }

    const data = await AlertDeliveryLogService.list(businessId, limit);
    res.json({ data });
  } catch (error) {
    logger.error("Error listing alert delivery log", {
      error,
      userId: user.uid,
      businessId,
      customerId: customerId || undefined,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** NT-75 — preview reconstructed customer email HTML from delivery history. */
export const previewAlertDeliveryLog = async (req: Request, res: Response) => {
  const user = (req as { user?: { uid: string } }).user;
  const businessId = String(req.query.businessId || req.body?.businessId || "").trim();
  const logId = String(req.params.logId || "").trim();

  if (!user?.uid || !businessId || !logId) {
    res.status(400).json({ error: "User ID, Business ID, and log ID are required" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const data = await previewAlertDeliveryLogEntry(businessId, logId);
    res.json({ data });
  } catch (error) {
    if (error instanceof AlertDeliveryResendError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    logger.error("Error previewing alert delivery log", {
      error,
      userId: user.uid,
      businessId,
      logId,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** NT-75 — retry a failed customer email from delivery history. */
export const resendAlertDeliveryLog = async (req: Request, res: Response) => {
  const user = (req as { user?: { uid: string } }).user;
  const businessId = String(req.body?.businessId || req.query.businessId || "").trim();
  const logId = String(req.params.logId || "").trim();

  if (!user?.uid || !businessId || !logId) {
    res.status(400).json({ error: "User ID, Business ID, and log ID are required" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const result = await resendAlertDeliveryLogEntry(businessId, logId);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AlertDeliveryResendError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    logger.error("Error resending alert delivery log", {
      error,
      userId: user.uid,
      businessId,
      logId,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
};
