import { Request, Response } from "express";
import type { QuerySnapshot } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { logger } from "../../services/observability/logging/logger";
import { QrCustomerService } from "../../services/customers/qr-customer-service";
import { transactionHasCustomerRating } from "../../services/portal/portal-rating-updates";
import { RiderTrackingService } from "../../services/riders/rider-tracking-service";
import { resolvePortalRiderTrackProfile } from "../../services/portal/portal-rider-track-profile";
import { searchPortalTrackOrders } from "../../services/portal/portal-track-search";

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
          customerId: String(sub.customerId || "").trim() || null,
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
