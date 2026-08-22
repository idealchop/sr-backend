import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import {
  logger,
  logAuditEvent,
} from "../services/observability/logging/logger";
import { NotificationService } from "../services/notifications/notification-service";
import { normalizePaymentAccountType } from "../utils/payment-account-type";

export { normalizePaymentAccountType };

/**
 * Verifies if a user has access to a business.
 * @param {string} uid The user ID.
 * @param {string} businessId The business ID.
 * @return {Promise<any>} The access result.
 */
const checkBusinessAccess = async (
  uid: string,
  businessId: string,
): Promise<{
  hasAccess: boolean;
  role?: string;
  businessDoc?: any;
}> => {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();

  if (!businessDoc.exists) return { hasAccess: false };

  const data = businessDoc.data();
  if (data?.ownerId === uid) {
    return { hasAccess: true, role: "owner", businessDoc };
  }

  const memberDoc = await businessRef.collection("members").doc(uid).get();
  if (memberDoc.exists) {
    return {
      hasAccess: true,
      role: memberDoc.data()?.role || "member",
      businessDoc,
    };
  }

  return { hasAccess: false };
};

/**
 * Lists payment information for a business.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listPaymentInfo = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const {
    filter,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = "1",
    limit = "100",
  } = req.query;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    let query: any = db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info");

    // Apply Filter (e.g., by bankName)
    if (filter) {
      query = query.where("bankName", "==", filter);
    }

    // Apply Sorting — fall back to unordered list if createdAt index/docs fail
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(
      200,
      Math.max(1, parseInt(limit as string, 10) || 100),
    );

    let snapshot;
    try {
      snapshot = await query
        .orderBy(sortBy as string, sortOrder as "asc" | "desc")
        .limit(limitNum)
        .offset((pageNum - 1) * limitNum)
        .get();
    } catch (orderError: any) {
      logger.warn(
        `Payment info ordered list failed for ${businessId}; falling back`,
        { error: orderError?.message || String(orderError) },
      );
      snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("payment_info")
        .limit(limitNum)
        .get();
    }

    const paymentInfos = snapshot.docs.map((doc: any) => {
      const data = doc.data() || {};
      return {
        ...data,
        type: normalizePaymentAccountType(data.type, data.bankName),
        id: doc.id,
      };
    });

    // Get total count for metadata
    const totalSnapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info")
      .count()
      .get();

    res.json({
      data: paymentInfos,
      meta: {
        totalCount: totalSnapshot.data().count,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error: any) {
    logger.error(
      `Error listing payment info for business ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Adds new payment information to a business.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const addPaymentInfo = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const { qrCode, bankName, accountName, accountNumber } = req.body;

  const trimmedBank =
    typeof bankName === "string" ? bankName.trim() : "";
  const trimmedNumber =
    typeof accountNumber === "string" ? accountNumber.trim() : "";
  const trimmedName =
    typeof accountName === "string" ? accountName.trim() : "";

  if (!trimmedBank) {
    res.status(400).json({ error: "Provider / bank name is required" });
    return;
  }
  if (!trimmedNumber && !trimmedName) {
    res.status(400).json({
      error: "Account number or account holder name is required",
    });
    return;
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Only owners can add payment info.",
        });
      return;
    }

    const paymentRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info")
      .doc();
    const type = normalizePaymentAccountType(req.body.type, trimmedBank);
    const persisted = {
      qrCode: typeof qrCode === "string" ? qrCode : "",
      bankName: trimmedBank,
      accountName: trimmedName,
      accountNumber: trimmedNumber,
      type,
      isPrimary: Boolean(req.body.isPrimary),
    };

    await paymentRef.set({
      ...persisted,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAuditEvent(
      "PAYMENT_INFO_ADDED",
      {
        businessId,
        userId: user.uid,
        paymentId: paymentRef.id,
      },
      null,
      persisted,
    );

    try {
      await NotificationService.send({
        userId: user.uid,
        businessId,
        title: "Payment Channel Added",
        message:
          `A new payment channel for ${trimmedBank} has been added to your station.`,
        type: "success",
      });
    } catch (notifyError: any) {
      logger.warn(
        `Payment info added but notification failed for ${businessId}`,
        { paymentId: paymentRef.id, error: notifyError?.message },
      );
    }

    res.status(201).json({
      success: true,
      paymentId: paymentRef.id,
      data: { id: paymentRef.id, ...persisted },
    });
  } catch (error: any) {
    logger.error(
      `Error adding payment info for business ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Updates existing payment information.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const updatePaymentInfo = async (req: Request, res: Response) => {
  const { businessId, paymentId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Only owners can update payment info.",
        });
      return;
    }

    const paymentRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info")
      .doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      res.status(404).json({ error: "Payment info not found" });
      return;
    }

    const oldData = paymentDoc.data() || {};
    const body = { ...(req.body || {}) };
    delete body.id;
    delete body.createdAt;
    delete body.updatedAt;

    if (typeof body.bankName === "string") {
      body.bankName = body.bankName.trim();
    }
    if (typeof body.accountName === "string") {
      body.accountName = body.accountName.trim();
    }
    if (typeof body.accountNumber === "string") {
      body.accountNumber = body.accountNumber.trim();
    }

    const nextBankName =
      typeof body.bankName === "string" ? body.bankName : oldData.bankName;
    body.type = normalizePaymentAccountType(
      body.type !== undefined ? body.type : oldData.type,
      nextBankName,
    );

    const newData = {
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await paymentRef.update(newData);

    const auditNewValue = { ...body };
    await logAuditEvent(
      "PAYMENT_INFO_UPDATED",
      {
        businessId,
        userId: user.uid,
        paymentId,
      },
      oldData,
      auditNewValue,
    );

    try {
      await NotificationService.send({
        userId: user.uid,
        businessId,
        title: "Payment Channel Updated",
        message:
          `The payment details for ${body.bankName || oldData.bankName || "the account"} ` +
          "have been updated.",
        type: "success",
      });
    } catch (notifyError: any) {
      logger.warn(
        `Payment info updated but notification failed for ${businessId}`,
        { paymentId, error: notifyError?.message },
      );
    }

    res.json({ success: true, message: "Payment info updated" });
  } catch (error: any) {
    logger.error(
      `Error updating payment info ${paymentId} for business ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Deletes one or multiple payment information records.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deletePaymentInfo = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const { paymentIds } = req.body; // Expecting an array for multiple delete
  const user = (req as any).user;

  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    res.status(400).json({ error: "Payment IDs array is required" });
    return;
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Only owners can delete payment info.",
        });
      return;
    }

    const batch = db.batch();
    const paymentCollection = db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info");

    const deletedData: any[] = [];
    for (const id of paymentIds) {
      const pDoc = await paymentCollection.doc(id).get();
      if (pDoc.exists) {
        deletedData.push({ id, ...(pDoc.data() || {}) });
        batch.delete(paymentCollection.doc(id));
      }
    }

    await batch.commit();

    await logAuditEvent(
      "PAYMENT_INFO_DELETED",
      {
        businessId,
        userId: user.uid,
        paymentIds,
      },
      deletedData,
      null,
    );

    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Payment Channel(s) Removed",
      message:
        `${paymentIds.length} payment channel(s) have been removed from your ` +
        "station configuration.",
      type: "warning",
    });

    res.json({
      success: true,
      message: `${paymentIds.length} payment info record(s) deleted`,
    });
  } catch (error: any) {
    logger.error(
      `Error deleting payment info for business ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};
