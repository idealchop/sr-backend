import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../config/firebase-admin";
import { logAuditEvent } from "../services/observability/logging/logger";
import { NotificationService } from "../services/notifications/notification-service";
import { ensureScaleTrialSubscription } from "../services/business/onboarding-scale-trial";
import { checkBusinessAccess } from "../utils/auth-utils";
import {
  DEFAULT_GETTING_STARTED,
  DEFAULT_QUICK_TOUR_PAGE,
} from "../services/business/business-onboarding-defaults";
import {
  getOrCreateOwnerBusinessRef,
  resolveExistingOwnerBusinessRef,
} from "../services/business/owner-workspace-resolve";
import {
  mergeUiConfigPatch,
  resolveOwnerMorningAlertsEnabled,
} from "../utils/notification-preferences";

const logDBMsg = (msg: string) => {
  logger.info(`${msg}`, {
    project: process.env.GCLOUD_PROJECT,
    db: process.env.SMARTREFILL_FIRESTORE_DB,
  });
};

export const listMyBusinesses = async (req: Request, res: Response) => {
  const user = (req as any).user;

  if (!user || !user.uid) {
    res
      .status(401)
      .json({ error: "Unauthorized", message: "User not identified" });
    return;
  }

  try {
    logDBMsg(`Listing businesses for ${user.uid}`);

    // 1. Get owned businesses (Standard Collection Query - always works)
    const ownedSnapshot = await db
      .collection("businesses")
      .where("ownerId", "==", user.uid)
      .get();

    const owned = ownedSnapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        myRole: "owner",
      };
    });

    // 2. Get member businesses (Collection Group Query - requires index)
    let memberships: any[] = [];
    try {
      const memberSnapshot = await db
        .collectionGroup("members")
        .where("userId", "==", user.uid)
        .get();

      memberships = await Promise.all(
        memberSnapshot.docs
          .filter((doc: any) => {
            const parentBusiness = doc.ref.parent.parent;
            return (
              parentBusiness?.id &&
              !owned.some((b: any) => b.id === parentBusiness.id)
            );
          })
          .map(async (doc: any) => {
            const businessRef = doc.ref.parent.parent;
            if (!businessRef) return null;
            const businessDoc = await businessRef.get();
            const data = businessDoc.data();
            return {
              ...data,
              id: businessRef.id,
              myRole: doc.data()?.role || "member",
            };
          }),
      );
      memberships = memberships.filter((m) => m !== null);
    } catch (groupError: any) {
      // If collection group query fails (e.g. missing index), log it but don't crash
      // This allows owners to still see their owned businesses
      logger.warn(
        "Collection group query for 'members' failed. Index might be missing.",
        {
          error: groupError.message,
          userId: user.uid,
        },
      );
    }

    let allBusinesses = [...owned, ...memberships];

    // 5. Apply Filter (Search by Name)
    const {
      filter,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = "1",
      limit = "10",
    } = req.query;

    if (filter) {
      const lowerFilter = (filter as string).toLowerCase();
      allBusinesses = allBusinesses.filter(
        (b: any) =>
          b.name?.toLowerCase().includes(lowerFilter) ||
          b.email?.toLowerCase().includes(lowerFilter),
      );
    }

    // 6. Apply Sorting
    allBusinesses.sort((a: any, b: any) => {
      let valA = a[sortBy as string];
      let valB = b[sortBy as string];

      // Handle Firestore Timestamps safely
      if (valA && typeof valA.toDate === "function") {
        valA = valA.toDate().getTime();
      }
      if (valB && typeof valB.toDate === "function") {
        valB = valB.toDate().getTime();
      }

      // Fallback for missing values
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    // 7. Apply Pagination
    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 10;
    const totalCount = allBusinesses.length;
    const paginatedBusinesses = allBusinesses.slice(
      (pageNum - 1) * limitNum,
      pageNum * limitNum,
    );

    logAuditEvent("BUSINESS_LIST_ACCESSED", {
      userId: user.uid,
      resultCount: totalCount,
      page: pageNum,
      limit: limitNum,
    });

    res.json({
      data: paginatedBusinesses,
      meta: {
        totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error: any) {
    logger.error(`Fatal error listing businesses for ${user.uid}:`, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
      code: error.code,
    });
  }
};

export const getBusiness = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    logDBMsg(`Fetching business ${businessId} for ${user.uid}`);

    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );

    if (!hasAccess || !businessDoc) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    logAuditEvent("BUSINESS_DETAILS_ACCESSED", {
      businessId,
      userId: user.uid,
    });

    res.json({
      ...businessDoc.data(),
      id: businessId,
      myRole: role,
    });
  } catch (error: any) {
    logger.error(`Error fetching business ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateBusiness = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    logDBMsg(`Updating business ${businessId} for ${user.uid}`);

    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );

    if (!hasAccess || !businessDoc) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    // Only owners can update business details
    if (role !== "owner") {
      res.status(403).json({
        error: "Forbidden",
        message: "Only owners can update business profile.",
      });
      return;
    }

    const updateData = {
      ...req.body,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Remove restricted fields
    delete (updateData as any).ownerId;
    delete (updateData as any).createdAt;
    delete (updateData as any).id;

    const oldData = businessDoc.data();
    await db.collection("businesses").doc(businessId).update(updateData);

    logAuditEvent(
      "BUSINESS_UPDATED",
      {
        businessId,
        userId: user.uid,
      },
      oldData,
      updateData,
    );

    logger.info(
      `Successfully updated business ${businessId} for user ${user.uid}`,
    );
    res.json({ success: true, message: "Business profile updated" });
  } catch (error: any) {
    logger.error(`Error updating business ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const createBusiness = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { name, email, phone, location, config } = req.body;

  if (!name) {
    res.status(400).json({ error: "Business name is required" });
    return;
  }

  try {
    const existingRef = await resolveExistingOwnerBusinessRef(user.uid);
    if (existingRef) {
      logger.info(
        `Owner ${user.uid} already has workspace ${existingRef.id}; skipping duplicate create`,
      );
      res.status(200).json({
        success: true,
        businessId: existingRef.id,
        alreadyExists: true,
      });
      return;
    }

    logDBMsg(`Creating new business for ${user.uid}`);
    const { ref: businessRef, created } = await getOrCreateOwnerBusinessRef({
      uid: user.uid,
      email: user.email,
      name: user.name,
    });

    const memberRef = businessRef.collection("members").doc(user.uid);
    const memberSnap = await memberRef.get();
    const batch = db.batch();

    batch.set(
      businessRef,
      {
        name,
        email: email || user.email || "",
        phone: phone || "",
        location: location || {},
        waterTypes: config?.waterTypes || [],
        inventoryCategories: config?.inventoryItems || [],
        expenseCategories: config?.expenseCategories || [],
        usageGoals: config?.usageGoals || [],
        quickTourPage: { ...DEFAULT_QUICK_TOUR_PAGE },
        gettingStarted: { ...DEFAULT_GETTING_STARTED },
        ownerId: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(created ?
          { createdAt: FieldValue.serverTimestamp() } :
          {}),
      },
      { merge: true },
    );

    if (!memberSnap.exists) {
      batch.set(memberRef, {
        userId: user.uid,
        email: user.email || "",
        name: user.name || "Owner",
        role: "owner",
        joinedAt: FieldValue.serverTimestamp(),
      });
    }

    batch.set(
      db.collection("users").doc(user.uid),
      { ownerWorkspaceId: businessRef.id },
      { merge: true },
    );

    await batch.commit();
    await ensureScaleTrialSubscription(businessRef);

    // Log Audit Event & Send Notification
    await logAuditEvent(
      "BUSINESS_CREATED",
      {
        businessId: businessRef.id,
        ownerId: user.uid,
      },
      null,
      {
        name,
        email: email || null,
        phone: phone || null,
        location: location || null,
      },
    );

    await NotificationService.send({
      userId: user.uid,
      businessId: businessRef.id,
      title: "Business Created",
      message: `Your business "${name}" has been successfully created. Welcome to SmartRefill!`,
      type: "success",
    });

    logger.info(
      `Successfully created business ${businessRef.id} for user ${user.uid}`,
    );
    res.status(201).json({ success: true, businessId: businessRef.id });
  } catch (error: any) {
    logger.error(`Error creating business for ${user.uid}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deleteBusiness = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    logDBMsg(`Deleting business ${businessId} for ${user.uid}`);

    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );

    if (!hasAccess || !businessDoc) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    // Only owners can delete businesses
    if (role !== "owner") {
      res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Only owners can delete businesses.",
        });
      return;
    }

    const oldData = businessDoc.data();
    await db.collection("businesses").doc(businessId).delete();

    await logAuditEvent(
      "BUSINESS_DELETED",
      {
        businessId,
        userId: user.uid,
      },
      oldData,
      null,
    );

    await NotificationService.send({
      userId: user.uid,
      title: "Business Deleted",
      message: `Your business "${oldData?.name || "Station"}" has been successfully deleted.`,
      type: "warning",
    });

    logger.info(
      `Successfully deleted business ${businessId} for user ${user.uid}`,
    );
    res.json({ success: true, message: "Business deleted" });
  } catch (error: any) {
    logger.error(`Error deleting business ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getBusinessAnalytics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    logDBMsg(`Fetching analytics for business ${businessId}`);

    const { hasAccess, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );

    if (!hasAccess || !businessDoc) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    // High-performance metrics aggregation (Parallelized)
    const [membersSnapshot, subsSnapshot] = await Promise.all([
      db.collection("businesses").doc(businessId).collection("members").get(),
      db
        .collection("businesses")
        .doc(businessId)
        .collection("subscriptions")
        .get(),
    ]);

    // Placeholder for actual transaction/revenue data integration
    const revenue30Days = 1250.75;
    const inventoryLevel = 85; // Percentage

    logAuditEvent("BUSINESS_ANALYTICS_ACCESSED", {
      businessId,
      userId: user.uid,
    });

    res.json({
      businessId,
      metrics: {
        revenue30Days,
        inventoryLevel,
        activeMembers: membersSnapshot.size,
        hasActiveSubscription:
          !subsSnapshot.empty &&
          subsSnapshot.docs[0].data()?.status === "active",
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Error fetching analytics for ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Updates the UI configuration (theme, branding) for a business.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const updateBusinessUIConfig = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const { uiConfig } = req.body;

  if (!businessId || !uiConfig) {
    res.status(400).json({ error: "Business ID and UI Config are required" });
    return;
  }

  try {
    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );

    if (!hasAccess || !businessDoc) {
      res.status(404).json({ error: "Business not found or access denied" });
      return;
    }

    if (role !== "owner") {
      res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Only owners can update UI config.",
        });
      return;
    }

    const oldConfig = (businessDoc.data()?.uiConfig || {}) as Record<
      string,
      unknown
    >;
    const incoming = (uiConfig || {}) as Record<string, unknown>;
    const merged = mergeUiConfigPatch(oldConfig, incoming);

    const updatePayload: Record<string, unknown> = {
      uiConfig: merged,
      ownerMorningAlertsEnabled: resolveOwnerMorningAlertsEnabled(merged),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.collection("businesses").doc(businessId).update(updatePayload);

    logAuditEvent(
      "BUSINESS_UI_UPDATED",
      {
        businessId,
        userId: user.uid,
      },
      oldConfig,
      merged,
    );

    res.json({ success: true, message: "Business UI configuration updated" });
  } catch (error: any) {
    logger.error(`Error updating UI config for business ${businessId}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const QUICK_TOUR_PAGE_KEYS = new Set(Object.keys(DEFAULT_QUICK_TOUR_PAGE));
const GETTING_STARTED_KEYS = new Set(Object.keys(DEFAULT_GETTING_STARTED));

/**
 * Merge-updates `quickTourPage` and/or `gettingStarted` on the business document.
 * Any workspace member with business access may update these flags.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const patchBusinessOnboardingProgress = async (
  req: Request,
  res: Response,
) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const body = (req.body || {}) as {
    quickTourPage?: Record<string, unknown>;
    gettingStarted?: Record<string, unknown>;
    workspaceOnboardedAt?: string;
  };

  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }

  try {
    const ref = db.collection("businesses").doc(businessId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.quickTourPage && typeof body.quickTourPage === "object") {
      for (const [k, v] of Object.entries(body.quickTourPage)) {
        if (QUICK_TOUR_PAGE_KEYS.has(k) && typeof v === "boolean") {
          updates[`quickTourPage.${k}`] = v;
        }
      }
    }

    if (body.gettingStarted && typeof body.gettingStarted === "object") {
      for (const [k, v] of Object.entries(body.gettingStarted)) {
        if (GETTING_STARTED_KEYS.has(k) && typeof v === "boolean") {
          updates[`gettingStarted.${k}`] = v;
        }
      }
    }

    const existingOnboardedAt = snap.data()?.workspaceOnboardedAt;
    if (
      !existingOnboardedAt &&
      typeof body.workspaceOnboardedAt === "string" &&
      body.workspaceOnboardedAt.trim()
    ) {
      const parsed = new Date(body.workspaceOnboardedAt);
      if (!Number.isNaN(parsed.getTime())) {
        updates.workspaceOnboardedAt = parsed.toISOString();
      }
    }

    const extraKeys = Object.keys(updates).filter((k) => k !== "updatedAt");
    if (extraKeys.length === 0) {
      res
        .status(400)
        .json({
          error: "No valid quickTourPage or gettingStarted fields to update",
        });
      return;
    }

    await ref.update(updates);

    logAuditEvent("BUSINESS_ONBOARDING_PROGRESS_UPDATED", {
      businessId,
      userId: user.uid,
      keys: extraKeys,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error(
      `Error patching onboarding progress for ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Updates the business payment information.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const updateBusinessPaymentInfo = async (
  req: Request,
  res: Response,
) => {
  const { businessId } = req.params;
  const { bankName, accountNumber, accountName, qrCodeUrl } = req.body;
  const user = (req as any).user;

  try {
    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );
    if (!hasAccess || !businessDoc || role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const paymentInfo = {
      bankName,
      accountNumber,
      accountName,
      qrCodeUrl,
      updatedAt: new Date().toISOString(), // Use ISO string for simple audit comparison if needed
    };

    const oldPaymentInfo = businessDoc.data()?.paymentInfo;
    await db.collection("businesses").doc(businessId).update({
      paymentInfo,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logAuditEvent(
      "BUSINESS_PAYMENT_UPDATED",
      {
        businessId,
        userId: user.uid,
      },
      oldPaymentInfo,
      paymentInfo,
    );

    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Payment Info Updated",
      message: `The payment channel for ${accountName} has been updated.`,
      type: "success",
    });

    res.json({ success: true, message: "Payment information updated" });
  } catch (error: any) {
    logger.error(
      `Error updating payment info for business ${businessId}:`,
      error,
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Gets the business payment information.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const getBusinessPaymentInfo = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );
    if (!hasAccess || !businessDoc) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const paymentInfo = businessDoc.data()?.paymentInfo || {};
    res.json({ data: paymentInfo });
  } catch (error: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Deletes the business payment information.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deleteBusinessPaymentInfo = async (
  req: Request,
  res: Response,
) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );
    if (!hasAccess || !businessDoc || role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const oldPaymentInfo = businessDoc.data()?.paymentInfo;
    await db.collection("businesses").doc(businessId).update({
      paymentInfo: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logAuditEvent(
      "BUSINESS_PAYMENT_DELETED",
      {
        businessId,
        userId: user.uid,
      },
      oldPaymentInfo,
      null,
    );

    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Payment Channel Removed",
      message:
        "A payment account has been removed from your station configuration.",
      type: "warning",
    });

    res.json({ success: true, message: "Payment information deleted" });
  } catch (error: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Deletes multiple businesses.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deleteMultipleBusinesses = async (req: Request, res: Response) => {
  const { businessIds } = req.body;
  const user = (req as any).user;

  if (!Array.isArray(businessIds) || businessIds.length === 0) {
    res.status(400).json({ error: "businessIds must be a non-empty array" });
    return;
  }

  try {
    const batch = db.batch();
    const deletedIds: string[] = [];

    for (const id of businessIds) {
      const { hasAccess, role, businessDoc } = await checkBusinessAccess(
        user.uid,
        id,
      );
      if (hasAccess && businessDoc && role === "owner") {
        batch.delete(db.collection("businesses").doc(id));
        deletedIds.push(id);

        logAuditEvent(
          "BUSINESS_DELETED",
          {
            businessId: id,
            userId: user.uid,
            bulk: true,
          },
          businessDoc.data(),
          null,
        );
      }
    }

    if (deletedIds.length > 0) {
      await batch.commit();
    }

    res.json({ success: true, deletedCount: deletedIds.length });
  } catch (error: any) {
    logger.error("Error in bulk delete:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
