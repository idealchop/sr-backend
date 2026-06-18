import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import { logAuditEventOncePerUtcDay } from "../services/observability/logging/audit-daily-dedupe";
import {
  logger,
  logAuditEvent,
} from "../services/observability/logging/logger";
import { SubscriptionService } from "../services/subscriptions/subscription-service";
import {
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
  pickPendingScheduled,
} from "../services/subscriptions/subscription-effective";
import {
  buildSubscriptionInvoicePdf,
  formatBusinessAddressForPdf,
} from "../services/subscriptions/subscription-invoice-pdf";
import { NotificationService } from "../services/notifications/notification-service";
import {
  addonExtensionMatchesPlan,
  hasCappedQuotas,
  parsePlanLimitations,
  subscriptionPlanRowMatchesCode,
} from "../utils/subscription-addon-plan-limits";
import { subscriptionRowEligibleForInvoicePdf } from "../utils/subscription-invoice-eligibility";
import { formatFirestorePhilippineDate } from "../utils/philippine-datetime";

/**
 * Recursively converts Firestore Timestamps to ISO strings in an object.
 * @param {any} obj The object to serialize.
 * @return {any} The serialized object.
 */
const serializeTimestamps = (obj: any): any => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(serializeTimestamps);

  const result: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val.toDate === "function") {
      result[key] = val.toDate().toISOString();
    } else if (typeof val === "object") {
      result[key] = serializeTimestamps(val);
    } else {
      result[key] = val;
    }
  }
  return result;
};

/**
 * Verifies if a user has access to a business.
... (Rest of the file with full logic)
 * @param {string} uid The user ID.
 * @param {string} businessId The business ID.
 * @return {Promise<any>} The access result.
 */
const checkBusinessAccess = async (uid: string, businessId: string) => {
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
 * Lists available subscription plans.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listPlans = async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    const query: any = db.collection("subscription_plans");

    const snapshot = await query.get();
    let plans = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
      };
    });

    // Fallback for empty environment (development/test)
    if (plans.length === 0) {
      plans = [
        {
          id: "starter",
          code: "starter",
          name: "Starter",
          price: 0,
          features: ["basic"],
        },
        { id: "pro", code: "pro", name: "Pro", price: 29, features: ["all"] },
        {
          id: "scale",
          code: "scale",
          name: "Scale",
          price: 99,
          features: ["all", "priority"],
        },
      ];
    }

    if (search) {
      const s = (search as string).toLowerCase();
      plans = plans.filter(
        (p: any) =>
          p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s),
      );
    }

    logAuditEvent("SUBSCRIPTION_PLANS_ACCESSED", {
      userId: (req as any).user?.uid,
    });
    res.json({ data: plans });
  } catch (error) {
    logger.error("Error listing plans", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Gets the current subscription status for a business.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
/**
 * Emulator-only: reset business subscriptions to a single Scale trial row (BDD isolation).
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const resetSubscriptionTrialForBdd = async (
  req: Request,
  res: Response,
) => {
  if (!process.env.FUNCTIONS_EMULATOR) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { businessId } = req.params;
  const user = (req as any).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await SubscriptionService.resetBusinessToTrialForEmulator(businessId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error("resetSubscriptionTrialForBdd", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getSubscriptionStatus = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    const status = await SubscriptionService.getSubscriptionStatus(businessId);
    void logAuditEventOncePerUtcDay("SUBSCRIPTION_STATUS_ACCESSED", {
      businessId,
      userId: user.uid,
    }).catch((err) => {
      logger.error("SUBSCRIPTION_STATUS_ACCESSED audit failed", err);
    });
    res.json({ data: serializeTimestamps(status) });
  } catch (error: any) {
    logger.error("Error getting subscription status", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Renews the current subscription.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const renewSubscription = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const { paymentDetails } = req.body;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Logic: Get current plan and start a new period
    const snapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(400).json({ error: "No active subscription to renew" });
    }

    const currentSub = snapshot.docs[0].data();
    await SubscriptionService.transitionSubscription(
      businessId,
      user.uid,
      currentSub.planCode || "scale",
      "RENEW",
      paymentDetails,
    );

    await logAuditEvent("SUBSCRIPTION_RENEWED", {
      businessId,
      userId: user.uid,
    });

    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Subscription Renewed",
      message:
        "Your current plan has been successfully renewed for another cycle.",
      type: "success",
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Upgrades the subscription.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const upgradeSubscription = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const { targetPlanCode, planCode, paymentDetails } = req.body;
  const resolvedPlan = targetPlanCode || planCode;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!resolvedPlan) {
      return res
        .status(400)
        .json({ error: "targetPlanCode or planCode is required" });
    }

    await SubscriptionService.transitionSubscription(
      businessId,
      user.uid,
      resolvedPlan,
      "UPGRADE",
      paymentDetails,
    );

    await logAuditEvent("SUBSCRIPTION_UPGRADED", {
      businessId,
      userId: user.uid,
      targetPlanCode: resolvedPlan,
    });

    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Plan Upgraded",
      message:
        `Your station has been upgraded to the ${resolvedPlan} plan. ` +
        "Enjoy the new features!",
      type: "success",
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Downgrades the subscription.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
const DOWNGRADE_REASON_CODES = new Set([
  "too_expensive",
  "not_using_features",
  "business_slowdown",
  "switching_solution",
  "temporary_pause",
  "other",
]);

export const downgradeSubscription = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const {
    targetPlanCode,
    planCode,
    paymentDetails,
    downgradeReasonCode,
    downgradeReasonDetail,
    attachProofOnly,
  } = req.body;
  const resolvedPlan = targetPlanCode || planCode;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!resolvedPlan) {
      return res
        .status(400)
        .json({ error: "targetPlanCode or planCode is required" });
    }

    if (attachProofOnly === true) {
      const pd =
        paymentDetails && typeof paymentDetails === "object" ? paymentDetails : {};
      const now = new Date();
      const rows = await fetchRecentSubscriptionRows(businessId);
      const pending = pickPendingScheduled(rows, now);
      const pendingMeta = pending?.data?.metadata as
        | { changeType?: string }
        | undefined;
      if (
        !pending ||
        pendingMeta?.changeType !== "downgrade" ||
        String(pending.data.planCode || "").toLowerCase() !==
          String(resolvedPlan).toLowerCase()
      ) {
        return res.status(400).json({
          error: "Bad Request",
          message: "No pending downgrade found for this plan.",
        });
      }

      await pending.ref.update({
        paymentReference: String(pd.paymentReference || ""),
        receiptUrl: typeof pd.receiptUrl === "string" ? pd.receiptUrl : "",
        paymentMethod: pd.paymentMethod,
        paymentStatus: "pending_verification",
      });

      await logAuditEvent("SUBSCRIPTION_DOWNGRADE_PROOF_ATTACHED", {
        businessId,
        userId: user.uid,
        targetPlanCode: resolvedPlan,
        subscriptionId: pending.id,
      });

      return res.json({ success: true });
    }

    const reasonCode =
      typeof downgradeReasonCode === "string" ?
        downgradeReasonCode.trim() :
        "";
    if (!DOWNGRADE_REASON_CODES.has(reasonCode)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "A valid downgrade reason is required.",
      });
    }
    const reasonDetail =
      typeof downgradeReasonDetail === "string" ?
        downgradeReasonDetail.trim().slice(0, 500) :
        "";
    if (reasonCode === "other" && reasonDetail.length < 10) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Please provide at least 10 characters when selecting Other.",
      });
    }

    const pd =
      paymentDetails && typeof paymentDetails === "object" ? paymentDetails : {};
    const mergedPaymentDetails: Record<string, unknown> = {
      ...pd,
      paymentStatus: pd.paymentStatus || "pending_verification",
      metadata: {
        ...(typeof pd.metadata === "object" && pd.metadata ? pd.metadata : {}),
        changeType: "downgrade",
        downgradeReasonCode: reasonCode,
        downgradeReasonDetail:
          reasonCode === "other" ? reasonDetail : undefined,
      },
    };

    await SubscriptionService.transitionSubscription(
      businessId,
      user.uid,
      resolvedPlan,
      "DOWNGRADE",
      mergedPaymentDetails,
    );

    await logAuditEvent("SUBSCRIPTION_DOWNGRADED", {
      businessId,
      userId: user.uid,
      targetPlanCode: resolvedPlan,
      downgradeReasonCode: reasonCode,
      downgradeReasonDetail:
        reasonCode === "other" ? reasonDetail : undefined,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("DEBUG: Handler error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Cancels the subscription.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const cancelSubscription = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await fetchRecentSubscriptionRows(businessId);
    const effective = pickEffectiveEntitling(rows, new Date());
    if (!effective) {
      return res.status(400).json({ error: "No active subscription" });
    }

    await effective.ref.update({
      "cancelAtPeriodEnd": true,
      "dates.cancelledAt": FieldValue.serverTimestamp(),
    });

    logAuditEvent("SUBSCRIPTION_CANCELLED", { businessId, userId: user.uid });
    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Subscription Cancelled",
      message:
        "Your subscription has been cancelled. " +
        "You will have access until the end of the period.",
      type: "info",
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Undoes a scheduled cancel-at-period-end (Keep My Plan).
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const resumeSubscription = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await fetchRecentSubscriptionRows(businessId);
    const effective = pickEffectiveEntitling(rows, new Date());
    if (!effective) {
      return res.status(400).json({ error: "No active subscription" });
    }

    if (!effective.data.cancelAtPeriodEnd) {
      return res.status(400).json({ error: "No scheduled cancellation" });
    }

    await effective.ref.update({
      "cancelAtPeriodEnd": false,
      "dates.cancelledAt": FieldValue.delete(),
    });

    logAuditEvent("SUBSCRIPTION_RESUMED", { businessId, userId: user.uid });
    await NotificationService.send({
      userId: user.uid,
      businessId,
      title: "Subscription Restored",
      message:
        "Your plan will continue to renew automatically at the end of this billing period.",
      type: "success",
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Lists subscription history.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listSubscriptionHistory = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const {
    page = "1",
    limit = "10",
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
  } = req.query;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    let query: any = db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions");

    // In Firestore we can't easily search subcollections by text with where
    // But we can filter by status or planName if provided
    if (search) {
      // Mocking search for demonstration (limited by Firestore)
      query = query.where("planName", "==", search);
    }

    query = query.orderBy(sortBy as string, sortOrder as "asc" | "desc");

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const snapshot = await query
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .get();

    const history = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
      };
    });
    const totalSnapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .count()
      .get();

    logAuditEvent("SUBSCRIPTION_HISTORY_ACCESSED", {
      businessId,
      userId: user.uid,
      resultCount: history.length,
      page: pageNum,
    });

    res.json({
      data: serializeTimestamps(history),
      meta: {
        totalCount: totalSnapshot.data().count,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    logger.error("Error listing history", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Downloads a PDF receipt for a paid subscription period (owner only).
 * Not available for free trial or Starter (free) rows.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const downloadSubscriptionHistoryInvoicePdf = async (
  req: Request,
  res: Response,
) => {
  const { businessId, subscriptionId } = req.params;
  const user = (req as any).user;
  try {
    const { hasAccess, role, businessDoc } = await checkBusinessAccess(
      user.uid,
      businessId,
    );
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .doc(subscriptionId)
      .get();

    if (!subSnap.exists) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const sub = subSnap.data() as Record<string, unknown>;
    if (!subscriptionRowEligibleForInvoicePdf(sub)) {
      return res.status(400).json({
        error:
          "Invoice PDF is only available for paid subscriptions (not free trial or Starter).",
      });
    }

    const biz = (
      businessDoc && typeof businessDoc.data === "function" ?
        businessDoc.data() :
        {}
    ) as Record<string, unknown>;
    const ownerId = String(biz.ownerId || "");
    let ownerDisplayName = "";
    let ownerEmail = "";
    if (ownerId) {
      const uSnap = await db.collection("users").doc(ownerId).get();
      if (uSnap.exists) {
        const u = uSnap.data() as Record<string, unknown>;
        ownerDisplayName = String(u.displayName || u.name || "");
        ownerEmail = String(u.email || "");
      }
    }

    const dates = (sub.dates || {}) as Record<string, unknown>;
    const priceNum =
      typeof sub.price === "number" ? sub.price : Number(sub.price);

    const pdfBuffer = await buildSubscriptionInvoicePdf({
      businessName: String(biz.name || biz.businessName || ""),
      businessEmail: String(biz.email || ""),
      businessPhone: String(biz.phone || ""),
      businessAddress: formatBusinessAddressForPdf(biz),
      ownerDisplayName,
      ownerEmail,
      subscriptionId,
      planName: String(sub.planName || ""),
      planCode: String(sub.planCode || ""),
      billingCycle: String(sub.billingCycle || ""),
      price: Number.isFinite(priceNum) ? priceNum : 0,
      paymentMethod: String(sub.paymentMethod || ""),
      paymentReference: String(sub.paymentReference || ""),
      paymentStatus: String(sub.paymentStatus || sub.status || ""),
      voucherCode: String(sub.voucherCode || ""),
      periodStart: formatFirestorePhilippineDate(dates.activatedAt),
      periodEnd: formatFirestorePhilippineDate(dates.expiresAt),
      renewalDate: formatFirestorePhilippineDate(dates.renewalAt),
    });

    logAuditEvent("SUBSCRIPTION_INVOICE_PDF_DOWNLOADED", {
      businessId,
      userId: user.uid,
      subscriptionId,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="SmartRefill-subscription-${subscriptionId}.pdf"`,
    );
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error("Error generating subscription invoice PDF", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Root catalog: subscription_addons & vouchers_affiliates (riverdb)
// ---------------------------------------------------------------------------

/**
 * Lists active subscription add-ons from the root `subscription_addons` collection.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const listCatalogAddons = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user?.uid) return res.status(401).json({ error: "Unauthorized" });
  try {
    const planCodeParam = String(
      (req.query as { planCode?: string }).planCode || "",
    )
      .trim()
      .toLowerCase();

    let limitationQuotas: ReturnType<typeof parsePlanLimitations> = null;
    let applyLimitationFilter = false;

    if (planCodeParam) {
      const plansSnap = await db.collection("subscription_plans").get();
      for (const doc of plansSnap.docs) {
        const pdata = doc.data() as Record<string, unknown>;
        if (subscriptionPlanRowMatchesCode(pdata, planCodeParam)) {
          const lim = pdata.limitations;
          if (
            lim &&
            typeof lim === "object" &&
            Object.keys(lim as object).length > 0
          ) {
            limitationQuotas = parsePlanLimitations(lim);
            applyLimitationFilter = hasCappedQuotas(limitationQuotas);
          }
          break;
        }
      }
    }

    const snapshot = await db.collection("subscription_addons").get();
    let rows = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...serializeTimestamps(doc.data()),
      }))
      .filter((row: any) => row.isActive !== false)
      .sort((a: any, b: any) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

    if (planCodeParam && applyLimitationFilter && limitationQuotas) {
      const quotasForFilter = limitationQuotas;
      rows = rows.filter((row: any) =>
        addonExtensionMatchesPlan(row.extendsPlanLimitation, quotasForFilter),
      );
    }

    logAuditEvent("SUBSCRIPTION_ADDONS_CATALOG_ACCESSED", {
      userId: user.uid,
      planCode: planCodeParam || undefined,
      limitationFilter: applyLimitationFilter,
    });
    res.json({ data: rows });
  } catch (error: any) {
    logger.error("Error listing subscription_addons", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

const asDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v === "string") return new Date(v);
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  return null;
};

/**
 * Validates a voucher code from `vouchers_affiliates` for checkout.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const validateCheckoutVoucher = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const body = req.body || {};
  const code = String(body.code || "")
    .trim()
    .toUpperCase();
  const planCode = String(body.planCode || "").toLowerCase();
  const billingCycle = String(body.billingCycle || "monthly");
  const subtotal = Number(body.subtotalBeforeDiscount);
  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    if (!code) {
      return res
        .status(400)
        .json({ data: { valid: false, message: "Code is required." } });
    }
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      return res
        .status(400)
        .json({ data: { valid: false, message: "Invalid subtotal." } });
    }

    const q = await db
      .collection("vouchers_affiliates")
      .where("kind", "==", "voucher")
      .where("code", "==", code)
      .limit(1)
      .get();

    if (q.empty) {
      return res.json({
        data: { valid: false, message: "This code is not valid." },
      });
    }

    const doc = q.docs[0];
    const v: any = doc.data();
    if (v.isActive === false) {
      return res.json({
        data: { valid: false, message: "This voucher is inactive." },
      });
    }

    const now = new Date();
    const from = asDate(v.validFrom);
    const until = asDate(v.validUntil);
    if (from && now < from) {
      return res.json({
        data: { valid: false, message: "This voucher is not active yet." },
      });
    }
    if (until && now > until) {
      return res.json({
        data: { valid: false, message: "This voucher has expired." },
      });
    }

    let planCodes: string[] = [];
    if (Array.isArray(v.applicablePlanCodes)) {
      planCodes = v.applicablePlanCodes.map((c: string) =>
        String(c).toLowerCase(),
      );
    }
    if (planCodes.length > 0 && (!planCode || !planCodes.includes(planCode))) {
      return res.json({
        data: {
          valid: false,
          message: "This voucher does not apply to your selected plan.",
        },
      });
    }

    let cycles: string[] = [];
    if (Array.isArray(v.applicableBillingCycles)) {
      cycles = v.applicableBillingCycles.map(String);
    }
    if (cycles.length > 0 && !cycles.includes(billingCycle)) {
      return res.json({
        data: {
          valid: false,
          message: "This voucher does not apply to this billing cycle.",
        },
      });
    }

    const minSub = typeof v.minSubtotal === "number" ? v.minSubtotal : null;
    if (minSub !== null && subtotal < minSub) {
      return res.json({
        data: {
          valid: false,
          message: `Minimum subtotal of ₱${minSub.toLocaleString()} required for this voucher.`,
        },
      });
    }

    const maxRed =
      typeof v.maxRedemptions === "number" ? v.maxRedemptions : null;
    const used = typeof v.redemptionCount === "number" ? v.redemptionCount : 0;
    if (maxRed !== null && used >= maxRed) {
      return res.json({
        data: {
          valid: false,
          message: "This voucher has reached its redemption limit.",
        },
      });
    }

    const dtype = String(v.discountType || "fixed_amount");
    const dval = Number(v.discountValue) || 0;
    let discountAmount = 0;
    if (dtype === "percentage") {
      discountAmount = Math.floor((subtotal * dval) / 100);
    } else if (dtype === "fixed_amount") {
      discountAmount = Math.min(dval, subtotal);
    } else {
      return res.json({
        data: { valid: false, message: "Unsupported discount type." },
      });
    }

    logAuditEvent("SUBSCRIPTION_VOUCHER_VALIDATED", {
      businessId,
      userId: user.uid,
      code,
    });

    return res.json({
      data: {
        valid: true,
        discountAmount,
        discountType: dtype,
        voucherId: doc.id,
        message: "Voucher applied.",
      },
    });
  } catch (error: any) {
    logger.error("validateCheckoutVoucher", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

/**
 * TEMPORARY: seeds `subscription_addons` and `vouchers_affiliates` for dev/staging.
 * Enable with env ALLOW_SUBSCRIPTION_DEV_SEED=true (remove in production).
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const seedSubscriptionCatalog = async (req: Request, res: Response) => {
  if (process.env.ALLOW_SUBSCRIPTION_DEV_SEED !== "true") {
    return res.status(403).json({
      error:
        "Disabled. Set ALLOW_SUBSCRIPTION_DEV_SEED=true on the Functions runtime.",
    });
  }
  const user = (req as any).user;
  if (!user?.uid) return res.status(401).json({ error: "Unauthorized" });

  try {
    const batch = db.batch();
    const ts = FieldValue.serverTimestamp();

    batch.set(
      db.collection("subscription_addons").doc("addon_ext_rider"),
      {
        code: "EXT_RIDER",
        name: "Additional 1 Rider Slot",
        description:
          "Adds one concurrent rider seat for deliveries and logistics.",
        price: 299,
        unit: 1,
        currency: "PHP",
        billingModel: "recurring",
        billingInterval: "monthly",
        isActive: true,
        sortOrder: 10,
        featureKey: "rider_slot",
        extendsPlanLimitation: "staff_rider",
        applicablePlanCodes: ["pro", "scale"],
        maxUnitsPerBusiness: 5,
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    batch.set(
      db.collection("subscription_addons").doc("addon_ai_boost"),
      {
        code: "EXT_AI_BOOST",
        name: "AI Operations Boost",
        description: "Adds 500 extra AI tool credits per billing cycle.",
        price: 450,
        unit: 1,
        currency: "PHP",
        billingModel: "recurring",
        billingInterval: "monthly",
        isActive: true,
        sortOrder: 20,
        featureKey: "ai_prompt_pack",
        extendsPlanLimitation: "ai_tools",
        applicablePlanCodes: ["pro", "scale"],
        maxUnitsPerBusiness: 3,
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    batch.set(
      db.collection("subscription_addons").doc("addon_ext_business"),
      {
        code: "EXT_BUSINESS",
        name: "Additional business",
        description:
          "Add another water refilling station to your account. Unlocks Owner hub rollup and station clone.",
        price: 990,
        unit: 1,
        currency: "PHP",
        billingModel: "recurring",
        billingInterval: "monthly",
        isActive: true,
        sortOrder: 30,
        featureKey: "extra_business",
        extendsPlanLimitation: "extra_business",
        applicablePlanCodes: ["pro", "scale", "enterprise"],
        maxUnitsPerBusiness: 10,
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    batch.set(
      db.collection("vouchers_affiliates").doc("voucher_discount100"),
      {
        kind: "voucher",
        code: "DISCOUNT100",
        name: "₱100 off subscription",
        isActive: true,
        discountType: "fixed_amount",
        discountValue: 100,
        maxRedemptions: 10000,
        redemptionCount: 0,
        stacksWithOtherPromos: false,
        notesInternal: "Seeded dev voucher",
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    batch.set(
      db.collection("vouchers_affiliates").doc("voucher_launch20"),
      {
        kind: "voucher",
        code: "LAUNCH20",
        name: "20% launch discount",
        isActive: true,
        discountType: "percentage",
        discountValue: 20,
        maxRedemptions: 5000,
        redemptionCount: 0,
        applicablePlanCodes: ["pro", "scale"],
        applicableBillingCycles: ["yearly"],
        stacksWithOtherPromos: false,
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    batch.set(
      db.collection("vouchers_affiliates").doc("affiliate_river_partner"),
      {
        kind: "affiliate",
        code: "REFRIVER",
        name: "River partner referral",
        isActive: true,
        ownerUserId: null,
        commissionType: "percentage",
        commissionValue: 10,
        conversionCount: 0,
        pendingCommissionAmount: 0,
        payoutCurrency: "PHP",
        notesInternal: "Seeded affiliate row; set ownerUserId when assigned",
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true },
    );

    await batch.commit();
    logAuditEvent("DEV_SEED_SUBSCRIPTION_CATALOG", { userId: user.uid });
    res.json({
      success: true,
      message: "Seeded subscription_addons and vouchers_affiliates (merge).",
    });
  } catch (error: any) {
    logger.error("seedSubscriptionCatalog", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};
