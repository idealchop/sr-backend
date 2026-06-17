import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";

/**
 * Lists audit logs for a specific business.
 * Restricted to users with access to the business.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listBusinessAuditLogs = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { businessId } = req.params;
  const { limit = "50", offset = "0" } = req.query;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    // 1. Verify access (similar to business-handler logic)
    const businessRef = db.collection("businesses").doc(businessId);
    const businessDoc = await businessRef.get();

    if (!businessDoc.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const memberDoc = await businessRef
      .collection("members")
      .doc(user.uid)
      .get();
    const isOwner = businessDoc.data()?.ownerId === user.uid;

    if (!isOwner && !memberDoc.exists) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // 2. Build Query - Equality filters should come before orderBy
    // for better performance and index usage
    let query: any = db
      .collection("businesses")
      .doc(businessId)
      .collection("audit_logs");

    if (req.query.itemId) {
      query = query.where("itemId", "==", req.query.itemId);
    }

    if (req.query.customerId) {
      query = query.where("customerId", "==", req.query.customerId);
    }

    if (req.query.event) {
      // Standardize event filtering to look for AUDIT: prefix
      query = query.where("message", "==", `AUDIT: ${req.query.event}`);
    }

    // Apply ordering and pagination
    const snapshot = await query
      .orderBy("timestamp", "desc")
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string))
      .get();

    const logs = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      let timestamp = data.timestamp;

      // Safe timestamp conversion
      if (data.timestamp?.toDate) {
        timestamp = data.timestamp.toDate().toISOString();
      } else if (data.timestamp instanceof Date) {
        timestamp = data.timestamp.toISOString();
      }

      return {
        ...data,
        id: doc.id,
        timestamp,
      };
    });

    res.json({
      data: logs,
      meta: {
        businessId,
        count: logs.length,
        limit: parseInt(limit as string),
      },
    });
  } catch (error: any) {
    logger.error("Error listing audit logs", {
      error: error.message,
      stack: error.stack,
      businessId,
      userId: user.uid,
    });

    // Always return the message for now to help the developer debug
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};
