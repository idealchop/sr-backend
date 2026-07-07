import { CustomerService } from "../customers/customer-service";
import { RiderService } from "../riders/rider-service";
import {
  TransactionService,
  type CollectionItem,
  type Transaction,
  type TransactionInventoryItem,
  type TransactionRefill,
} from "./transaction-service";
import { NEARBY_STOP_RADIUS_KM } from "./claim-nearby-stop-service";
import {
  buildNearbyQuietCustomers,
  buildRepeatNearbyTransactionSeed,
  getLastFulfilledOperationalTransaction,
} from "./nearby-quiet-customers";
import { logAuditEvent } from "../observability/logging/logger";

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

export class ClaimNearbyDormantError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "ClaimNearbyDormantError";
    this.statusCode = statusCode;
  }
}

async function verifyNearbyCustomer(params: {
  businessId: string;
  customerId: string;
  riderLat: number;
  riderLng: number;
}): Promise<{
  customer: NonNullable<Awaited<ReturnType<typeof CustomerService.getCustomer>>>;
  km: number;
}> {
  const customer = await CustomerService.getCustomer(
    params.businessId,
    params.customerId,
  );
  if (!customer) {
    throw new ClaimNearbyDormantError(404, "Customer not found");
  }

  const lat = customer.latitude;
  const lng = customer.longitude;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new ClaimNearbyDormantError(
      400,
      "Customer location is missing; cannot verify distance",
    );
  }

  const km = haversineKm(params.riderLat, params.riderLng, lat, lng);
  if (km > NEARBY_STOP_RADIUS_KM) {
    throw new ClaimNearbyDormantError(
      400,
      `Customer is outside the ${NEARBY_STOP_RADIUS_KM} km nearby radius`,
    );
  }

  return { customer, km };
}

export async function claimNearbyDormantForLinkedRider(params: {
  businessId: string;
  customerId: string;
  riderId: string;
  riderLat: number;
  riderLng: number;
  actorId: string;
  orderSpec?: {
    type?: "delivery" | "collection";
    refillQty?: number;
    deliveryLines?: TransactionRefill[];
    items?: TransactionInventoryItem[];
    collectionItems?: CollectionItem[];
    repeatLast?: boolean;
  };
}): Promise<{ transactionId: string; referenceId: string }> {
  const { customer, km } = await verifyNearbyCustomer(params);

  const rider = await RiderService.getRider(params.businessId, params.riderId);
  if (!rider?.id) {
    throw new ClaimNearbyDormantError(403, "Rider profile not found");
  }

  const transactions = await TransactionService.getTransactionsByBusiness(
    params.businessId,
    { limit: 500, orderBy: "scheduledAt" },
  );

  const quietRows = buildNearbyQuietCustomers({
    customers: [customer],
    transactions,
    thresholdDays: undefined,
  });
  const quiet = quietRows.find((r) => r.customerId === params.customerId);
  if (!quiet) {
    throw new ClaimNearbyDormantError(
      400,
      "Customer is not a quiet nearby suki (needs 15+ days since last fulfilled order and no open order)",
    );
  }

  const lastTx = getLastFulfilledOperationalTransaction(
    params.customerId,
    transactions,
  );
  const seed = buildRepeatNearbyTransactionSeed(
    lastTx,
    customer,
    quiet.daysSinceLastOrder,
    params.orderSpec,
  );

  const { transaction } = await TransactionService.addTransaction(
    params.businessId,
    {
      ...seed,
      customerId: params.customerId,
      customerName: customer.name || quiet.customerName,
      riderId: rider.id,
      scheduledAt: new Date().toISOString(),
    } as Partial<Transaction>,
    params.actorId,
  );

  if (!transaction.id) {
    throw new ClaimNearbyDormantError(500, "Failed to create route stop");
  }

  await logAuditEvent(
    "NEARBY_DORMANT_CLAIMED",
    {
      businessId: params.businessId,
      customerId: params.customerId,
      transactionId: transaction.id,
      claimerRiderId: rider.id,
      daysSinceLastOrder: quiet.daysSinceLastOrder,
      distanceKm: Math.round(km * 1000) / 1000,
      source: "rider_messenger",
    },
    null,
    { riderId: rider.id },
    transaction.id,
    ["riderId"],
  );

  return {
    transactionId: transaction.id,
    referenceId: transaction.referenceId || transaction.id,
  };
}

export async function claimNearbyDormantForRider(params: {
  businessId: string;
  customerId: string;
  claimerUid: string;
  claimerBusinessRole: string;
  riderLat: number;
  riderLng: number;
}): Promise<{ transactionId: string; referenceId: string }> {
  if (params.claimerBusinessRole === "owner" || params.claimerBusinessRole === "admin") {
    throw new ClaimNearbyDormantError(
      403,
      "Only riders and station staff can add quiet nearby sukis from My Area",
    );
  }
  if (params.claimerBusinessRole !== "rider" && params.claimerBusinessRole !== "staff") {
    throw new ClaimNearbyDormantError(
      403,
      "Only riders and station staff with a rider profile can add quiet nearby sukis",
    );
  }

  const claimerRider = await RiderService.getRiderByUserId(
    params.businessId,
    params.claimerUid,
  );
  if (!claimerRider?.id) {
    throw new ClaimNearbyDormantError(
      403,
      "No rider profile linked to your account",
    );
  }

  return claimNearbyDormantForLinkedRider({
    businessId: params.businessId,
    customerId: params.customerId,
    riderId: claimerRider.id,
    riderLat: params.riderLat,
    riderLng: params.riderLng,
    actorId: params.claimerUid,
  });
}
