import { Request, Response } from "express";
import type { QuerySnapshot } from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../../services/observability/logging/logger";
import { QrCustomerService } from "../../services/customers/qr-customer-service";
import { resolvePortalCompletionTransaction } from
  "../../services/portal/portal-transaction-completion";
import { resolvePortalBalancePaymentTransaction } from
  "../../services/portal/portal-balance-payment";
import {
  ratingPatchFromPortalPayload,
  transactionHasCustomerRating,
} from "../../services/portal/portal-rating-updates";
import { PortalOrderRatingService } from "../../services/portal/portal-order-rating-service";
import { PortalBusinessProfileService } from "../../services/portal/portal-business-profile-service";
import { RawSubmissionService } from "../../services/portal/raw-submission-service";
import { TransactionService } from "../../services/transactions/transaction-service";
import { CustomerService } from "../../services/customers/customer-service";
import { RiderTrackingService } from "../../services/riders/rider-tracking-service";
import type {
  RawSubmissionPayload,
  RawSubmissionType,
} from "../../services/portal/raw-submission-types";
import { resolvePortalRiderTrackProfile } from "../../services/portal/portal-rider-track-profile";
import { searchPortalTrackOrders } from "../../services/portal/portal-track-search";

const SUBMISSION_TYPES: RawSubmissionType[] = [
  "PROFILE_UPDATE",
  "PLACE_ORDER",
  "REQUEST_COLLECTION",
  "COMPLETE_TX",
  "MARK_TX_COMPLETE",
  "PORTAL_PAY_BALANCE",
  "PORTAL_PREFERRED_SCHEDULE",
  "PORTAL_TX_RATINGS",
];

function parseQueryString(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

function serializePortalTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "_seconds" in value) {
    const sec = (value as { _seconds: number })._seconds;
    return new Date(sec * 1000).toISOString();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

/**
 * Other active stops assigned to the same rider (excludes current transaction).
 * @param {string} businessId Business tenant id.
 * @param {string} riderId Rider document id.
 * @param {string} excludeTxId Transaction to exclude from the count.
 * @return {Promise<number>} Count of other pending/placed/in-transit stops.
 */
async function countRiderOtherActiveStops(
  businessId: string,
  riderId: string,
  excludeTxId: string,
): Promise<number> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("riderId", "==", riderId)
    .get();
  return snap.docs.filter((doc) => {
    if (doc.id === excludeTxId) return false;
    const s = String(doc.data()?.deliveryStatus || "");
    return s === "in-transit" || s === "pending" || s === "placed";
  }).length;
}

function customerDestinationFromData(
  customer: FirebaseFirestore.DocumentData | undefined,
): { latitude: number; longitude: number; address?: string } | null {
  if (!customer) return null;
  const loc = customer.location;
  if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
    return {
      latitude: loc.lat,
      longitude: loc.lng,
      address: typeof loc.address === "string" ? loc.address : undefined,
    };
  }
  const lat = customer.latitude ?? customer.lat;
  const lng = customer.longitude ?? customer.lng;
  if (typeof lat === "number" && typeof lng === "number") {
    return {
      latitude: lat,
      longitude: lng,
      address:
        typeof customer.address === "string" ? customer.address : undefined,
    };
  }
  return null;
}

/**
 * JSON body may send ids as strings or occasionally other primitives.
 * @param {unknown} v
 * @return {string}
 */
function parseBodyString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

/**
 * Portal raw_submissions still awaiting staff (accept/cancel) for this transaction.
 * @param {string} businessId
 * @param {string} txDocId
 * @param {string} transactionReferenceId
 * @return {"payment" | "completion" | null}
 */
async function getPendingPortalReviewKindForTx(
  businessId: string,
  txDocId: string,
  transactionReferenceId: string,
): Promise<"payment" | "completion" | null> {
  const refTrim = (transactionReferenceId || "").trim();
  const col = db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions");
  try {
    const queries: Promise<QuerySnapshot>[] = [
      col
        .where("status", "==", "pending_review")
        .where("payload.targetTransactionId", "==", txDocId)
        .limit(10)
        .get(),
    ];
    if (refTrim) {
      queries.push(
        col
          .where("status", "==", "pending_review")
          .where("payload.transactionReferenceId", "==", refTrim)
          .limit(10)
          .get(),
      );
    }
    const snaps = await Promise.all(queries);
    const seen = new Set<string>();
    let kind: "payment" | "completion" | null = null;
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const submissionType = String(d.data()?.submissionType || "");
        if (submissionType === "PORTAL_PAY_BALANCE") {
          kind = "payment";
        } else if (
          (submissionType === "MARK_TX_COMPLETE" ||
            submissionType === "COMPLETE_TX") &&
          kind !== "payment"
        ) {
          kind = "completion";
        } else if (!kind && submissionType) {
          kind = "completion";
        }
      }
    }
    return kind;
  } catch (e: any) {
    logger.warn("getPendingPortalReviewKindForTx failed", {
      businessId,
      txDocId,
      message: e?.message,
    });
    return null;
  }
}

export const getQrPng = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const customerId = parseQueryString(req.query.c);
  const token = parseQueryString(req.query.t);
  if (!businessId || !customerId || !token) {
    return res.status(400).send("Missing b, c, or t");
  }
  try {
    const png = await QrCustomerService.renderQrPng(
      businessId,
      customerId,
      token,
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(png);
  } catch (e: any) {
    const code = e?.message;
    if (code === "INVALID_TOKEN" || code === "NOT_FOUND") {
      return res.status(404).send("Not found");
    }
    if (code === "INACTIVE_CUSTOMER") {
      return res.status(403).send("Inactive");
    }
    logger.error("getQrPng failed", e);
    return res.status(500).send("Error");
  }
};

export const getPortalCustomerContext = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const customerId = parseQueryString(req.query.c);
  const token = parseQueryString(req.query.t);

  if (!businessId) {
    return res.status(400).json({ error: "Missing business ID (b)" });
  }

  try {
    let customer: any = null;
    if (customerId && token) {
      customer = await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );
    }

    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const biz = bizSnap.data();
    if (!bizSnap.exists) {
      return res.status(404).json({ error: "Station not found" });
    }

    // Fetch Inventory Items (filtered to basic info)
    const inventorySnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("inventory_items")
      .get();
    const inventory = inventorySnap.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name,
      categoryId: doc.data().categoryId,
    }));

    // Fetch Active Transactions for monitoring (only if we have a customer)
    let activeTransactions: any[] = [];
    if (customerId) {
      const txSnap = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", customerId)
        .where("deliveryStatus", "in", [
          "pending",
          "in-transit",
          "delivered",
          "collected",
        ])
        .orderBy("createdAt", "desc")
        .limit(10)
        .get();
      activeTransactions = txSnap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          referenceId: d.referenceId,
          type: d.type,
          deliveryStatus: d.deliveryStatus,
          totalAmount: d.totalAmount,
          scheduledAt: d.scheduledAt,
        };
      });
    }

    const paymentSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("payment_info")
      .get();
    const paymentAccounts = paymentSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        bankName: d.bankName || "",
        accountName: d.accountName || "",
        accountNumber: d.accountNumber || "",
        type: d.type || "bank_transfer",
        qrCode: d.qrCode || undefined,
      };
    });

    const first = (customer?.name || "Suki").split(/\s+/)[0];
    const bizLat = biz?.location?.lat ?? biz?.latitude;
    const bizLng = biz?.location?.lng ?? biz?.longitude;
    const businessLocation =
      typeof bizLat === "number" &&
      typeof bizLng === "number" &&
      Number.isFinite(bizLat) &&
      Number.isFinite(bizLng) ?
        {
          latitude: bizLat,
          longitude: bizLng,
          address:
            typeof biz?.location?.address === "string" ?
              biz.location.address :
              typeof biz?.address === "string" ?
                biz.address :
                undefined,
        } :
        null;
    return res.json({
      data: {
        customerId: customerId || "",
        businessId,
        firstName: first,
        name: customer?.name || "",
        email: customer?.email || "",
        phone: customer?.phone || "",
        businessName: biz?.businessName || biz?.name || "Your water station",
        businessLogo: typeof biz?.logo === "string" ? biz.logo : null,
        businessLocation,
        address: customer?.address || "",
        latitude: customer?.latitude,
        longitude: customer?.longitude,
        sukiType: customer?.sukiType || "personal",
        companyName: customer?.companyName || "",
        pricing: customer?.pricing || {},
        qrCodeUrl: customer?.qrCodeUrl,
        portalDeepLink: customer?.portalDeepLink,
        inventory,
        waterTypes: (biz?.waterTypes || []).map((w: any) =>
          typeof w === "string" ? { id: w, name: w } : w,
        ),
        activeTransactions,
        paymentAccounts,
        qrWalkInEnabled: biz?.qrWalkInEnabled === true,
        isDeliveryEnabled: customer?.isDeliveryEnabled === true,
        isCollectionEnabled: customer?.isCollectionEnabled === true,
        deliveryConfig: customer?.deliveryConfig ?? null,
        collectionConfig: customer?.collectionConfig ?? null,
      },
    });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid or expired link" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    if (e?.message === "INACTIVE_CUSTOMER") {
      return res.status(403).json({ error: "Account inactive" });
    }
    logger.error("getPortalCustomerContext failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getPortalBusinessProfile = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  if (!businessId) {
    return res.status(400).json({ error: "Missing business ID (b)" });
  }

  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.max(
    1,
    Number.parseInt(String(req.query.pageSize ?? "5"), 10) || 5,
  );

  try {
    const profile = await PortalBusinessProfileService.getPublicProfile({
      businessId,
      page,
      pageSize,
    });
    if (!profile) {
      return res.status(404).json({ error: "Station not found" });
    }
    return res.json({ data: profile });
  } catch (e) {
    logger.error("getPortalBusinessProfile failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const postPortalSubmission = async (req: Request, res: Response) => {
  const businessId = parseBodyString(req.body?.businessId);
  const customerId = parseBodyString(req.body?.customerId);
  const token = parseBodyString(req.body?.token);
  const submissionType = req.body?.submissionType as RawSubmissionType;
  const legalAgreed = req.body?.legalAgreed === true;
  const payload = (req.body?.payload || {}) as RawSubmissionPayload;

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }
  if (!SUBMISSION_TYPES.includes(submissionType)) {
    return res.status(400).json({ error: "Invalid submissionType" });
  }
  if (!legalAgreed) {
    return res.status(400).json({ error: "Terms must be accepted" });
  }

  try {
    const isMarkCompleteRequest =
      submissionType === "MARK_TX_COMPLETE" || submissionType === "COMPLETE_TX";

    if (isMarkCompleteRequest) {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      try {
        const { current, txDocId } = await resolvePortalCompletionTransaction(
          businessId,
          cid && tok ? cid : "",
          payload,
        );
        const custForDoc =
          String(current.customerId || "").trim() || (cid && tok ? cid : "");

        const fulfillmentKind =
          current.type === "collection" || current.type === "delivery" ?
            current.type :
            undefined;
        const enrichedPayload = {
          ...payload,
          targetTransactionId: txDocId,
          transactionReferenceId:
            (typeof payload.transactionReferenceId === "string" &&
              payload.transactionReferenceId.trim()) ||
            String(current.referenceId || "").trim(),
          ...(fulfillmentKind ? { type: fulfillmentKind } : {}),
        };

        const { id, referenceId } = await RawSubmissionService.createPending(
          businessId,
          custForDoc,
          "MARK_TX_COMPLETE",
          enrichedPayload,
          { legalAgreed, userAgent: req.get("user-agent") },
        );
        return res
          .status(201)
          .json({ data: { id, referenceId, status: "pending_review" } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_NOT_READY_FOR_COMPLETION") {
          return res.status(409).json({
            error:
              "This order cannot be completed until it is marked Delivered or Collected.",
          });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal MARK_TX_COMPLETE create failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_PAY_BALANCE") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      const amt = Number(payload.payment?.amountPaid);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res
          .status(400)
          .json({ error: "A positive payment amount is required." });
      }
      try {
        const { current, txDocId } =
          await resolvePortalBalancePaymentTransaction(
            businessId,
            cid && tok ? cid : "",
            payload,
          );
        const deliveryStatus = String(current.deliveryStatus || "").toLowerCase();
        const isAdvancePayment =
          payload.portalPaymentPhase === "advance" ||
          !["delivered", "collected", "completed"].includes(deliveryStatus);
        const payMethod = String(payload.payment?.method || "").toLowerCase();
        const cashConfirmed = payload.payment?.confirmedByRider === true;
        if (isAdvancePayment) {
          if (cashConfirmed || payMethod === "cash" || !payMethod) {
            return res.status(400).json({
              error:
                "Advance payments must use bank transfer or e-wallet. " +
                "Cash is available after delivery.",
            });
          }
          const proof = payload.payment?.proofUrl;
          const ref = String(payload.payment?.reference || "").trim();
          if (!proof && !ref) {
            return res.status(400).json({
              error:
                "Upload payment proof or enter a reference for advance payment.",
            });
          }
        }
        const custForDoc =
          String(current.customerId || "").trim() || (cid && tok ? cid : "");

        const paymentPhase: "advance" | "balance" = isAdvancePayment ?
          "advance" :
          "balance";
        const enrichedPayload = {
          ...payload,
          portalPaymentPhase: paymentPhase,
          targetTransactionId: txDocId,
          transactionReferenceId:
            (typeof payload.transactionReferenceId === "string" &&
              payload.transactionReferenceId.trim()) ||
            String(current.referenceId || "").trim(),
        };

        await PortalOrderRatingService.recordFromPortalPayload({
          businessId,
          txDocId,
          transaction: current,
          payload: enrichedPayload,
          customerIdHint: custForDoc,
          source: "portal_balance_pay",
        });

        const { id, referenceId } = await RawSubmissionService.createPending(
          businessId,
          custForDoc,
          "PORTAL_PAY_BALANCE",
          enrichedPayload,
          { legalAgreed, userAgent: req.get("user-agent") },
        );
        return res
          .status(201)
          .json({ data: { id, referenceId, status: "pending_review" } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_ALREADY_PAID") {
          return res
            .status(409)
            .json({ error: "This order is already fully paid." });
        }
        if (msg === "TX_NOT_ELIGIBLE_FOR_PORTAL_PAYMENT") {
          return res
            .status(400)
            .json({ error: "Balance payments apply to delivery orders only." });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal PORTAL_PAY_BALANCE create failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_PREFERRED_SCHEDULE") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      const schedule = payload.schedule;
      if (!schedule || typeof schedule !== "object") {
        return res.status(400).json({ error: "Schedule details are required." });
      }
      const isDeliveryEnabled = schedule.isDeliveryEnabled === true;
      const isCollectionEnabled = schedule.isCollectionEnabled === true;
      if (!isDeliveryEnabled && !isCollectionEnabled) {
        return res.status(400).json({
          error: "Enable delivery or collection schedule before saving.",
        });
      }
      try {
        let resolvedCustomerId = "";
        if (cid && tok) {
          await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
          resolvedCustomerId = cid;
        } else {
          const targetTxId =
            typeof payload.targetTransactionId === "string" ?
              payload.targetTransactionId.trim() :
              "";
          const txRef =
            typeof payload.transactionReferenceId === "string" ?
              payload.transactionReferenceId.trim() :
              "";
          let txCustomerId = "";
          if (targetTxId) {
            const tx = await TransactionService.getTransaction(businessId, targetTxId);
            txCustomerId = String(tx?.customerId || "").trim();
          }
          if (!txCustomerId && txRef) {
            const txSnap = await db
              .collection("businesses")
              .doc(businessId)
              .collection("transactions")
              .where("referenceId", "==", txRef)
              .limit(1)
              .get();
            if (!txSnap.empty) {
              txCustomerId = String(txSnap.docs[0].data()?.customerId || "").trim();
            }
          }
          resolvedCustomerId = txCustomerId;
        }
        if (!resolvedCustomerId) {
          return res.status(401).json({
            error: "Open the portal from your station QR link to save your preferred schedule.",
          });
        }
        await CustomerService.updateCustomer(businessId, resolvedCustomerId, {
          isDeliveryEnabled,
          isCollectionEnabled,
          deliveryConfig: isDeliveryEnabled ?
            (schedule.deliveryConfig as Record<string, unknown>) || { frequency: "weekly" } :
            undefined,
          collectionConfig: isCollectionEnabled ?
            (schedule.collectionConfig as Record<string, unknown>) || { frequency: "weekly" } :
            undefined,
        } as any);
        return res.json({ data: { success: true } });
      } catch (e) {
        logger.error("portal PORTAL_PREFERRED_SCHEDULE failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_TX_RATINGS") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      try {
        const { current, txDocId } = await resolvePortalCompletionTransaction(
          businessId,
          cid && tok ? cid : "",
          payload,
        );
        if (
          cid &&
          tok &&
          current.customerId &&
          String(current.customerId) !== cid
        ) {
          return res.status(403).json({ error: "Forbidden" });
        }
        const patch = ratingPatchFromPortalPayload(payload);
        if (Object.keys(patch).length === 0) {
          return res.status(400).json({
            error: "Add at least one star rating or a short written note.",
          });
        }

        await PortalOrderRatingService.recordFromPortalPayload({
          businessId,
          txDocId,
          transaction: current,
          payload,
          customerIdHint: cid && tok ? cid : undefined,
          source:
            payload.portalRatingSource === "portal_track_complete" ||
            payload.portalRatingSource === "portal_balance_pay" ||
            payload.portalRatingSource === "portal_ratings" ||
            payload.portalRatingSource === "portal_counter_walkin" ?
              payload.portalRatingSource :
              "portal_ratings",
        });

        await TransactionService.updateTransaction(
          businessId,
          txDocId,
          patch as Record<string, unknown>,
          "portal_customer",
        );
        return res.json({ data: { success: true } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_NOT_READY_FOR_COMPLETION") {
          return res.status(409).json({
            error:
              "Ratings are available after the order is delivered or collected.",
          });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal PORTAL_TX_RATINGS failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (customerId && token) {
      await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );
    }

    if (payload.type === "walkin") {
      const bizSnap = await db.collection("businesses").doc(businessId).get();
      if (bizSnap.data()?.qrWalkInEnabled !== true) {
        return res.status(403).json({
          error: "Walk-in QR orders are not enabled for this station.",
          code: "QR_WALKIN_DISABLED",
        });
      }
    }

    // If no customerId, we still allow submission (e.g. for new customers)
    // The dashboard will handle creating/linking the customer during review.
    const { id, referenceId, walkInQueueNumber } = await RawSubmissionService.createPending(
      businessId,
      customerId,
      submissionType,
      payload,
      { legalAgreed, userAgent: req.get("user-agent") },
    );

    return res
      .status(201)
      .json({
        data: {
          id,
          referenceId,
          status: "pending_review",
          ...(walkInQueueNumber != null ? { walkInQueueNumber } : {}),
        },
      });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    if (e?.message === "INACTIVE_CUSTOMER") {
      return res.status(403).json({ error: "Inactive" });
    }
    if (e?.message === "LEGAL_REQUIRED") {
      return res.status(400).json({ error: "Legal consent required" });
    }
    if (e?.code === "ONLINE_ORDER_LIMIT_EXCEEDED") {
      return res.status(403).json({
        error:
          e?.message ||
          "This station has reached its online order limit. Please try again later.",
        code: "ONLINE_ORDER_LIMIT_EXCEEDED",
      });
    }
    logger.error("postPortalSubmission failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * Customer-facing tracker hint: staff merged portal profile onto existing suki vs
 * accept() registered a new customer from the portal.
 * `identified` takes precedence if both flags exist.
 * @param {Record<string, unknown>} sub Raw submission document data.
 * @return {"identified" | "registered" | "none"}
 */
function portalCustomerTrackStatus(
  sub: Record<string, unknown>,
): "identified" | "registered" | "none" {
  const meta = sub.metadata;
  if (!meta || typeof meta !== "object") return "none";
  const m = meta as Record<string, unknown>;
  if (m.profileMergedAt != null) return "identified";
  if (m.customerRegisteredAt != null) return "registered";
  return "none";
}

export const searchTrackOrders = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const filters = {
    name: parseQueryString(req.query.name),
    email: parseQueryString(req.query.email),
    company: parseQueryString(req.query.company),
    phone: parseQueryString(req.query.phone),
    q: parseQueryString(req.query.q),
  };

  if (!businessId) {
    return res.status(400).json({ error: "Missing businessId (b)" });
  }

  const hasTerm = [filters.name, filters.email, filters.company, filters.phone, filters.q]
    .some((s) => (s || "").trim().length >= 2);
  if (!hasTerm) {
    return res.status(400).json({
      error: "Enter at least one field with 2 or more characters",
    });
  }

  try {
    let scopedCustomerId: string | undefined;
    const cid = parseQueryString(req.query.c);
    const tok = parseQueryString(req.query.t);
    if (cid && tok) {
      try {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
        scopedCustomerId = cid;
      } catch {
        /* ignore invalid portal session; search by contact fields only */
      }
    }

    const data = await searchPortalTrackOrders(
      businessId,
      filters,
      25,
      scopedCustomerId,
    );
    return res.json({ data });
  } catch (e: any) {
    if (e?.message === "QUERY_TOO_SHORT") {
      return res
        .status(400)
        .json({ error: "Enter at least one field with 2 or more characters" });
    }
    logger.error("searchTrackOrders failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const trackOrder = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.query.b);
  const referenceId = req.params.referenceId;

  if (!businessId || !referenceId) {
    return res.status(400).json({ error: "Missing businessId or referenceId" });
  }

  try {
    // 1. Check transactions first (canonical orders)
    const txSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();

    if (!txSnap.empty) {
      const tx = txSnap.docs[0].data();
      const txDocId = txSnap.docs[0].id;
      const refForPending = String(tx.referenceId || referenceId || "").trim();
      const statusLower = String(tx.deliveryStatus || "").toLowerCase();
      const isTerminalStatus = ["cancelled", "failed", "rejected"].includes(
        statusLower,
      );
      const pendingStaffReviewKind = !isTerminalStatus ?
        await getPendingPortalReviewKindForTx(
          businessId,
          txDocId,
          refForPending,
        ) :
        null;
      let riderLocation: {
        latitude: number;
        longitude: number;
        updatedAt?: string | null;
      } | null = null;
      let riderName: string | undefined;
      let riderPhotoUrl: string | undefined;
      let riderPhone: string | undefined;
      let riderAvgRating: number | null = null;
      let riderIsRecordOnly = false;
      if (tx.riderId) {
        const riderSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("riders")
          .doc(tx.riderId)
          .get();
        const rider = riderSnap.data();
        const profile = await resolvePortalRiderTrackProfile(
          businessId,
          tx.riderId,
          rider,
          typeof tx.riderName === "string" ? tx.riderName : undefined,
        );
        riderName = profile.riderName;
        riderPhotoUrl = profile.riderPhotoUrl;
        riderPhone = profile.riderPhone;
        riderAvgRating = profile.riderAvgRating;
        riderIsRecordOnly = profile.riderIsRecordOnly;
        if (!riderIsRecordOnly) {
          const loc =
            tx.deliveryStatus === "in-transit" ?
              await RiderTrackingService.getRiderLastLocation(
                businessId,
                tx.riderId,
              ) :
              rider?.lastLocation;
          if (
            loc &&
            typeof loc.latitude === "number" &&
            typeof loc.longitude === "number"
          ) {
            riderLocation = {
              latitude: loc.latitude,
              longitude: loc.longitude,
              updatedAt: serializePortalTimestamp(loc.updatedAt),
            };
          }
        }
      }

      let destination: {
        latitude: number;
        longitude: number;
        address?: string;
      } | null = null;
      if (tx.customerId) {
        const custSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("customers")
          .doc(tx.customerId)
          .get();
        destination = customerDestinationFromData(custSnap.data());
      }

      let portalCustomerStatus:
        | "identified"
        | "registered"
        | "none"
        | undefined;
      if (refForPending) {
        const subHintSnap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("raw_submissions")
          .where("referenceId", "==", refForPending)
          .limit(1)
          .get();
        if (!subHintSnap.empty) {
          const sd = subHintSnap.docs[0].data();
          if (sd) {
            portalCustomerStatus = portalCustomerTrackStatus(
              sd as Record<string, unknown>,
            );
          }
        }
      }

      const riderOtherActiveStops =
        tx.riderId ?
          await countRiderOtherActiveStops(businessId, tx.riderId, txDocId) :
          0;

      return res.json({
        data: {
          type: "transaction",
          id: txDocId,
          referenceId: tx.referenceId,
          customerId: tx.customerId || null,
          status: tx.deliveryStatus,
          typeLabel: tx.type,
          totalAmount: tx.totalAmount,
          balanceDue: tx.balanceDue,
          paymentMethod: tx.paymentMethod,
          paymentStatus: tx.paymentStatus,
          notes: tx.notes,
          riderLocation,
          riderName,
          riderPhotoUrl,
          riderPhone,
          riderAvgRating,
          riderIsRecordOnly,
          destination,
          riderOtherActiveStops,
          arrivedAt: serializePortalTimestamp(tx.arrivedAt),
          deliveredAt: serializePortalTimestamp(tx.deliveredAt),
          scheduledAt: tx.scheduledAt,
          rejectReason: tx.rejectReason, // if any
          pendingStaffReviewKind,
          portalCustomerStatus,
          hasCustomerRating: transactionHasCustomerRating(tx),
        },
      });
    }

    // 2. Check raw_submissions (pending review)
    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();

    if (!subSnap.empty) {
      const sub = subSnap.docs[0].data();
      if (!sub) {
        return res.status(404).json({ error: "Order not found" });
      }
      // Reference exists only as a portal submission (no transaction yet).
      // pending_review = awaiting station triage — show as pending, not "order placed".
      // Legacy `rejected` rows map to cancelled for customers; new declines store `cancelled`.
      const displayStatus =
        sub.status === "pending_review" ?
          "pending" :
          sub.status === "rejected" ?
            "cancelled" :
            sub.status;
      return res.json({
        data: {
          type: "submission",
          id: subSnap.docs[0].id,
          referenceId: sub.referenceId,
          status: displayStatus,
          typeLabel: sub.submissionType,
          totalAmount: sub.payload?.totalAmount,
          paymentMethod: sub.payload?.payment?.method,
          notes: sub.payload?.notes,
          scheduledAt: sub.payload?.scheduledAt,
          rejectReason: sub.rejectReason,
          portalCustomerStatus: portalCustomerTrackStatus(
            sub as Record<string, unknown>,
          ),
        },
      });
    }

    return res.status(404).json({ error: "Order not found" });
  } catch (e: any) {
    logger.error("trackOrder failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

export const cancelPortalOrder = async (req: Request, res: Response) => {
  const businessId = parseQueryString(req.body?.businessId);
  const customerId = parseQueryString(req.body?.customerId) || "";
  const token = parseQueryString(req.body?.token) || "";
  const referenceId = parseQueryString(req.body?.referenceId);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!businessId || !referenceId) {
    return res
      .status(400)
      .json({ error: "businessId and referenceId are required" });
  }
  if (!reason || reason.length < 3) {
    return res
      .status(400)
      .json({ error: "A cancellation reason (min 3 characters) is required." });
  }

  try {
    // Validate token if provided (authenticated customer)
    if (customerId && token) {
      await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );
    }

    // Find the submission by referenceId
    const subSnap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .where("referenceId", "==", referenceId)
      .limit(1)
      .get();

    if (subSnap.empty) {
      return res.status(404).json({ error: "Order not found" });
    }

    const subDoc = subSnap.docs[0];
    const sub = subDoc.data();

    // Only allow cancellation of pending orders
    if (sub.status !== "pending_review") {
      return res.status(409).json({
        error:
          "This order can no longer be cancelled. Current status: " +
          sub.status,
      });
    }

    await subDoc.ref.update({
      status: "cancelled",
      rejectReason: `CANCEL_REQUEST: ${reason}`.slice(0, 500),
      processedAt: FieldValue.serverTimestamp(),
    });

    logger.info("portal order cancelled by customer", {
      businessId,
      referenceId,
      reason,
    });
    return res.json({ success: true });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    logger.error("cancelPortalOrder failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};

/** NT-35 — update customer portal notification preferences. */
export const patchPortalCustomerProfile = async (req: Request, res: Response) => {
  const businessId = parseBodyString(req.body?.businessId ?? req.query.b);
  const customerId = parseBodyString(req.body?.customerId ?? req.query.c);
  const token = parseBodyString(req.body?.token ?? req.query.t);

  if (!businessId || !customerId || !token) {
    return res.status(400).json({ error: "businessId, customerId, and token are required" });
  }

  try {
    await QrCustomerService.assertValidPortalToken(businessId, customerId, token);

    const updates: Record<string, unknown> = {};
    if (typeof req.body?.portalEmailNotifications === "boolean") {
      updates.portalEmailNotifications = req.body.portalEmailNotifications;
    }
    if (typeof req.body?.portalSmsOptIn === "boolean") {
      updates.portalSmsOptIn = req.body.portalSmsOptIn;
    }
    if (typeof req.body?.portalWebPushEnabled === "boolean") {
      updates.portalWebPushEnabled = req.body.portalWebPushEnabled;
    }
    if (typeof req.body?.portalWebPushToken === "string" && req.body.portalWebPushToken.trim()) {
      updates.portalWebPushTokens = FieldValue.arrayUnion(
        req.body.portalWebPushToken.trim(),
      );
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid preference fields" });
    }

    await CustomerService.updateCustomer(
      businessId,
      customerId,
      updates as Partial<import("../../services/customers/customer-service").Customer>,
    );

    return res.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    logger.error("patchPortalCustomerProfile failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};
