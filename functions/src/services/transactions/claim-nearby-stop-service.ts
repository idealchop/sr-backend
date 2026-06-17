import { db } from "../../config/firebase-admin";
import { logAuditEvent } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { CustomerService } from "../customers/customer-service";
import { RiderService } from "../riders/rider-service";
import { TransactionService } from "./transaction-service";

/** Match My Area / operations delivery tracker “nearby” radius */
export const NEARBY_STOP_RADIUS_KM = 1;

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class ClaimNearbyStopError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ClaimNearbyStopError";
    this.statusCode = statusCode;
  }
}

// eslint-disable-next-line valid-jsdoc
/**
 * Rider/staff claims a pending/placed stop within radius (My Area).
 * May reassign from another rider (override); notifies previous rider, owner, and admins.
 */
export async function claimNearbyStopForRider(params: {
  businessId: string;
  transactionId: string;
  claimerUid: string;
  claimerBusinessRole: string;
  riderLat: number;
  riderLng: number;
}): Promise<{ ok: true; previousRiderId: string | null }> {
  const {
    businessId,
    transactionId,
    claimerUid,
    claimerBusinessRole,
    riderLat,
    riderLng,
  } = params;

  if (claimerBusinessRole === "owner" || claimerBusinessRole === "admin") {
    throw new ClaimNearbyStopError(
      403,
      "Only riders and station staff can claim nearby stops from My Area",
    );
  }
  if (claimerBusinessRole !== "rider" && claimerBusinessRole !== "staff") {
    throw new ClaimNearbyStopError(
      403,
      "Only riders and station staff with a rider profile can claim nearby stops",
    );
  }

  if (
    typeof riderLat !== "number" ||
    typeof riderLng !== "number" ||
    !Number.isFinite(riderLat) ||
    !Number.isFinite(riderLng)
  ) {
    throw new ClaimNearbyStopError(400, "riderLat and riderLng are required");
  }

  const claimerRider = await RiderService.getRiderByUserId(
    businessId,
    claimerUid,
  );
  if (!claimerRider?.id) {
    throw new ClaimNearbyStopError(
      403,
      "No rider profile linked to your account",
    );
  }

  const txRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .doc(transactionId);
  const txSnap = await txRef.get();
  if (!txSnap.exists) {
    throw new ClaimNearbyStopError(404, "Transaction not found");
  }
  const tx = txSnap.data() as Record<string, unknown>;
  const type = tx.type as string;
  if (type !== "delivery" && type !== "collection") {
    throw new ClaimNearbyStopError(
      400,
      "Only delivery or collection transactions can be claimed this way",
    );
  }

  const ds = tx.deliveryStatus as string | undefined;
  if (ds !== "pending" && ds !== "placed") {
    throw new ClaimNearbyStopError(
      400,
      "Only pending or placed orders can be added from nearby",
    );
  }

  const customerId = tx.customerId as string | undefined;
  if (!customerId) {
    throw new ClaimNearbyStopError(400, "Transaction has no customer");
  }

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) {
    throw new ClaimNearbyStopError(400, "Customer not found");
  }

  const lat = customer.latitude;
  const lng = customer.longitude;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new ClaimNearbyStopError(
      400,
      "Customer location is missing; cannot verify distance",
    );
  }

  const km = haversineKm(riderLat, riderLng, lat, lng);
  if (km > NEARBY_STOP_RADIUS_KM) {
    throw new ClaimNearbyStopError(
      400,
      `Stop is outside the ${NEARBY_STOP_RADIUS_KM} km nearby radius`,
    );
  }

  const previousRiderId =
    typeof tx.riderId === "string" ? tx.riderId : undefined;

  if (previousRiderId === claimerRider.id) {
    return { ok: true, previousRiderId: previousRiderId ?? null };
  }

  await TransactionService.updateTransaction(
    businessId,
    transactionId,
    { riderId: claimerRider.id },
    claimerUid,
  );

  const customerName =
    (tx.customerName as string) || customer.name || "Customer";
  const claimerName = claimerRider.name || "A rider";
  const reassigned = previousRiderId ? " (reassigned)" : "";
  const msg = `${claimerName} added ${customerName} to their route from nearby${reassigned}.`;

  let previousUserId: string | undefined;
  if (previousRiderId) {
    const prevRider = await RiderService.getRider(businessId, previousRiderId);
    if (prevRider?.userId) {
      previousUserId = prevRider.userId;
    }
    if (previousUserId && previousUserId !== claimerUid) {
      await NotificationService.send({
        userId: previousUserId,
        businessId,
        title: "Stop moved to another rider",
        message: `${customerName} was reassigned to ${claimerName}'s route from My Area (nearby).`,
        type: "warning",
        metadata: { transactionId, customerId },
      });
    }
  }

  const biz = await db.collection("businesses").doc(businessId).get();
  const ownerId = biz.data()?.ownerId as string | undefined;
  if (ownerId && ownerId !== claimerUid) {
    await NotificationService.send({
      userId: ownerId,
      businessId,
      title: "Nearby stop claimed",
      message: msg,
      type: "info",
      metadata: { transactionId, customerId },
    });
  }

  const membersSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .get();
  for (const doc of membersSnap.docs) {
    if (doc.data()?.role === "admin" && doc.id !== claimerUid) {
      await NotificationService.send({
        userId: doc.id,
        businessId,
        title: "Nearby stop claimed",
        message: msg,
        type: "info",
        metadata: { transactionId, customerId },
      });
    }
  }

  await logAuditEvent(
    "NEARBY_STOP_CLAIMED",
    {
      businessId,
      transactionId,
      claimerUid,
      claimerRiderId: claimerRider.id,
      previousRiderId: previousRiderId || null,
      distanceKm: Math.round(km * 1000) / 1000,
    },
    null,
    { riderId: claimerRider.id },
    transactionId,
    ["riderId"],
  );

  return { ok: true, previousRiderId: previousRiderId ?? null };
}
