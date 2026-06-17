import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import type { Transaction } from "../transactions/transaction-service";
import type { RawSubmissionType } from "../portal/raw-submission-types";
import {
  NotificationService,
  type NotificationPayload,
} from "./notification-service";

type NotifyType = NotificationPayload["type"];

const MANAGEMENT_ROLES = new Set(["owner", "admin", "staff"]);

function formatPeso(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function cleanLabel(value: string | undefined, fallback: string): string {
  const v = (value || "").trim();
  if (!v) return fallback;
  if (/^[a-zA-Z0-9_-]{18,}$/.test(v) && !v.includes(" ")) {
    return fallback;
  }
  return v;
}

export function transactionTypeLabel(type: string | undefined): string {
  switch (type) {
  case "walkin":
    return "Walk-in sale";
  case "direct_sale":
    return "Direct sale";
  case "expense":
    return "Expense";
  case "collection":
    return "Collection";
  case "delivery":
  default:
    return "Delivery order";
  }
}

export function deliveryStatusLabel(status: string | undefined): string {
  switch (status) {
  case "pending":
    return "pending";
  case "placed":
    return "placed";
  case "in-transit":
    return "in transit";
  case "delivered":
    return "delivered";
  case "collected":
    return "collected";
  case "completed":
    return "completed";
  case "failed":
    return "failed";
  case "cancelled":
    return "cancelled";
  default:
    return status || "updated";
  }
}

function transactionReviewMeta(
  tx: Partial<Transaction> & { id?: string },
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reviewTab: "transactions",
    category: "transaction",
    transactionId: tx.id,
    referenceId: tx.referenceId,
    customerId: tx.customerId,
    customerName: tx.customerName,
    ...extra,
  };
}

async function listManagementUserIds(businessId: string): Promise<string[]> {
  const [membersSnap, businessDoc] = await Promise.all([
    db.collection("businesses").doc(businessId).collection("members").get(),
    db.collection("businesses").doc(businessId).get(),
  ]);
  const ownerId = businessDoc.data()?.ownerId as string | undefined;
  const ids = new Set<string>();
  if (ownerId) ids.add(ownerId);
  for (const doc of membersSnap.docs) {
    const role = String(doc.data()?.role || "").toLowerCase();
    if (MANAGEMENT_ROLES.has(role) && doc.data()?.isActive !== false) {
      ids.add(doc.id);
    }
  }
  return [...ids];
}

async function resolveActorLabel(
  businessId: string,
  userId?: string,
): Promise<string> {
  if (!userId) return "Station staff";
  const memberSnap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(userId)
    .get();
  const member = memberSnap.data();
  const fromMember =
    (typeof member?.displayName === "string" && member.displayName.trim()) ||
    (typeof member?.name === "string" && member.name.trim()) ||
    "";
  if (fromMember) return fromMember;

  const rider = await RiderService.getRiderByUserId(businessId, userId);
  if (rider?.name) return rider.name;

  return "Station staff";
}

async function sendToUsers(
  businessId: string,
  userIds: string[],
  payload: Omit<NotificationPayload, "userId" | "businessId">,
  excludeUserIds: string[] = [],
): Promise<void> {
  const exclude = new Set(excludeUserIds.filter(Boolean));
  const unique = [...new Set(userIds.filter((id) => id && !exclude.has(id)))];
  await Promise.all(
    unique.map((userId) =>
      NotificationService.send({
        ...payload,
        userId,
        businessId,
      }).catch((err) => {
        logger.warn("station activity notification failed", {
          businessId,
          userId,
          title: payload.title,
          error: err,
        });
      }),
    ),
  );
}

async function notifyManagement(
  businessId: string,
  payload: Omit<NotificationPayload, "userId" | "businessId">,
  opts?: { excludeUserIds?: string[] },
): Promise<void> {
  const userIds = await listManagementUserIds(businessId);
  await sendToUsers(businessId, userIds, payload, opts?.excludeUserIds);
}

async function notifyRiderUser(
  businessId: string,
  riderId: string | undefined,
  payload: Omit<NotificationPayload, "userId" | "businessId">,
): Promise<void> {
  if (!riderId) return;
  const rider = await RiderService.getRider(businessId, riderId);
  const userId = rider?.userId;
  if (!userId) return;
  await sendToUsers(businessId, [userId], payload);
}

function buildAmountLine(tx: Partial<Transaction>): string {
  const total = tx.totalAmount ?? 0;
  if (tx.type === "expense") {
    return formatPeso(total);
  }
  if (tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial") {
    const due = tx.balanceDue ?? total;
    return `${formatPeso(total)} (${formatPeso(due)} balance due)`;
  }
  if (total > 0) return formatPeso(total);
  return "";
}

function customerLabel(tx: Partial<Transaction>): string {
  return cleanLabel(tx.customerName, "Walk-in customer");
}

function referenceLabel(tx: Partial<Transaction>): string {
  const ref = (tx.referenceId || "").trim();
  return ref || "Ledger entry";
}

/**
 * In-app activity feed when a ledger transaction is created.
 * @param {string} businessId Business id.
 * @param {object} tx Created transaction.
 * @param {string} [actorUserId] User who performed the action.
 * @return {Promise<void>}
 */
export async function notifyTransactionCreated(
  businessId: string,
  tx: Transaction & { id?: string },
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const customer = customerLabel(tx);
  const ref = referenceLabel(tx);
  const amountLine = buildAmountLine(tx);
  const typeLabel = transactionTypeLabel(tx.type);
  const riderName = cleanLabel(tx.riderName, "");

  let title: string;
  let message: string;
  let type: NotifyType = "info";

  switch (tx.type) {
  case "expense":
    title = "Expense recorded";
    message = [
      actor !== "Station staff" ? `${actor} recorded` : "Recorded",
      tx.expenseCategory ? `${tx.expenseCategory}` : "an expense",
      amountLine ? `for ${amountLine}` : "",
      `(${ref}).`,
    ]
      .filter(Boolean)
      .join(" ");
    type = "warning";
    break;
  case "walkin":
  case "direct_sale":
    title = typeLabel;
    message = `${customer} — ${amountLine || "completed"} (${ref}).`;
    type = "success";
    break;
  case "collection":
    title = "Collection scheduled";
    message = `${customer} — ${amountLine || "collection"} (${ref})${
      riderName ? ` · Rider: ${riderName}` : ""
    }.`;
    break;
  case "delivery":
  default:
    title = "New delivery order";
    message = `${customer} — ${amountLine || "order"} (${ref})${
      riderName ? ` · Assigned to ${riderName}` : ""
    }.`;
    if (tx.deliveryStatus === "placed") {
      title = "Portal order accepted";
    }
    if (tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial") {
      type = "warning";
    }
    break;
  }

  const meta = transactionReviewMeta(tx, {
    transactionType: tx.type,
    deliveryStatus: tx.deliveryStatus,
    riderId: tx.riderId,
  });

  await notifyManagement(businessId, {
    title,
    message,
    type,
    metadata: meta,
  }, { excludeUserIds: actorUserId ? [actorUserId] : [] });

  if (tx.riderId && (tx.type === "delivery" || tx.type === "collection")) {
    await notifyRiderUser(businessId, tx.riderId, {
      title: tx.type === "collection" ? "New collection stop" : "New delivery assigned",
      message: `${customer} — ${ref}${
        amountLine ? ` · ${amountLine}` : ""
      }.`,
      type: "info",
      metadata: meta,
    });
  }
}

/**
 * In-app activity feed for meaningful transaction updates.
 * @param {string} businessId Business id.
 * @param {string} transactionId Transaction document id.
 * @param {Transaction} before Prior transaction state.
 * @param {Transaction} after Updated transaction state.
 * @param {string} [actorUserId] User who performed the action.
 * @param {string[]} [changedFields] Changed field names.
 * @return {Promise<void>}
 */
export async function notifyTransactionUpdated(
  businessId: string,
  transactionId: string,
  before: Transaction,
  after: Transaction,
  actorUserId?: string,
  changedFields: string[] = [],
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const customer = customerLabel(after);
  const ref = referenceLabel(after);
  const meta = transactionReviewMeta(
    { ...after, id: transactionId },
    { transactionType: after.type },
  );

  const changed = new Set(changedFields);
  const statusChanged =
    changed.has("deliveryStatus") &&
    after.deliveryStatus !== before.deliveryStatus;
  const riderChanged =
    changed.has("riderId") && after.riderId !== before.riderId;
  const paymentChanged =
    changed.has("paymentStatus") && after.paymentStatus !== before.paymentStatus;
  const amountChanged =
    changed.has("totalAmount") && after.totalAmount !== before.totalAmount;
  const coreEdited =
    changed.has("items") ||
    changed.has("waterRefills") ||
    changed.has("collectionItems");

  if (statusChanged && after.deliveryStatus) {
    const status = deliveryStatusLabel(after.deliveryStatus);
    const riderName = cleanLabel(after.riderName, "");
    let title = "Order status updated";
    let type: NotifyType = "info";
    let message = `${customer} is now ${status} (${ref})${
      riderName ? ` · ${riderName}` : ""
    }.`;

    if (
      after.deliveryStatus === "delivered" ||
      after.deliveryStatus === "collected" ||
      after.deliveryStatus === "completed"
    ) {
      title =
        after.type === "collection" ? "Collection completed" : "Delivery completed";
      message = `${riderName || actor} completed ${customer} (${ref})${
        buildAmountLine(after) ? ` · ${buildAmountLine(after)}` : ""
      }.`;
      type = "success";
    } else if (
      after.deliveryStatus === "in-transit"
    ) {
      title = "Rider en route";
      message = `${riderName || "Rider"} is on the way to ${customer} (${ref}).`;
    } else if (
      after.deliveryStatus === "failed" ||
      after.deliveryStatus === "cancelled"
    ) {
      title = "Order cancelled";
      message = `${customer} (${ref}) was marked ${status}.`;
      type = "warning";
    }

    await notifyManagement(businessId, { title, message, type, metadata: meta });
  }

  if (riderChanged && after.riderId) {
    const riderName =
      cleanLabel(after.riderName, "") ||
      (await RiderService.getRider(businessId, after.riderId))?.name ||
      "Rider";
    await notifyManagement(businessId, {
      title: "Rider reassigned",
      message: `${customer} (${ref}) assigned to ${riderName}.`,
      type: "info",
      metadata: meta,
    });
    await notifyRiderUser(businessId, after.riderId, {
      title:
        after.type === "collection" ?
          "Collection added to your route" :
          "Delivery added to your route",
      message: `${customer} (${ref}).`,
      type: "info",
      metadata: meta,
    });
    if (before.riderId && before.riderId !== after.riderId) {
      await notifyRiderUser(businessId, before.riderId, {
        title: "Stop removed from your route",
        message: `${customer} (${ref}) was reassigned to another rider.`,
        type: "warning",
        metadata: meta,
      });
    }
  }

  if (paymentChanged && after.paymentStatus === "paid") {
    await notifyManagement(businessId, {
      title: "Payment received",
      message: `${customer} paid ${formatPeso(after.totalAmount ?? 0)} (${ref}).`,
      type: "success",
      metadata: meta,
    });
  } else if (
    paymentChanged &&
    (after.paymentStatus === "partial" || after.paymentStatus === "unpaid")
  ) {
    await notifyManagement(businessId, {
      title: "Balance updated",
      message: `${customer} now has ${formatPeso(after.balanceDue ?? 0)} outstanding (${ref}).`,
      type: "warning",
      metadata: meta,
    });
  }

  if (coreEdited || amountChanged) {
    const fields: string[] = [];
    if (coreEdited) fields.push("line items");
    if (amountChanged) fields.push("amount");
    await notifyManagement(businessId, {
      title: "Ledger entry adjusted",
      message: `${actor} updated ${fields.join(" and ")} for ${customer} (${ref}).`,
      type: "info",
      metadata: meta,
    }, { excludeUserIds: actorUserId ? [actorUserId] : [] });
  }
}

export async function notifyPortalSubmissionCreated(
  businessId: string,
  opts: {
    submissionId: string;
    submissionType: RawSubmissionType;
    customerId: string;
    customerName: string;
    referenceId: string;
    portalOrderKind?: string;
  },
): Promise<void> {
  const name = cleanLabel(opts.customerName, "A customer");
  const ref = opts.referenceId.trim() || "Portal request";
  let title = "New portal order";
  let message = `${name} placed an order (${ref}).`;

  switch (opts.submissionType) {
  case "REQUEST_COLLECTION":
    title = "Collection request (QR)";
    message = `${name} requested a container pickup (${ref}).`;
    break;
  case "PORTAL_PAY_BALANCE":
    title = "Portal payment";
    message = `${name} sent a balance payment (${ref}).`;
    break;
  case "MARK_TX_COMPLETE":
  case "COMPLETE_TX":
    title = "Customer marked order complete";
    message = `${name} confirmed completion (${ref}).`;
    break;
  case "PLACE_ORDER":
    if (opts.portalOrderKind === "walkin") {
      title = "Counter QR walk-in";
      message = `${name} checked in at the counter (${ref}).`;
    } else if (opts.portalOrderKind === "collection") {
      title = "Portal collection request";
      message = `${name} requested collection (${ref}).`;
    } else {
      title = "New QR order";
      message = `${name} placed a delivery order (${ref}).`;
    }
    break;
  default:
    break;
  }

  await notifyManagement(businessId, {
    title,
    message,
    type: "info",
    metadata: {
      reviewTab: "transactions",
      category: "portal",
      submissionId: opts.submissionId,
      customerId: opts.customerId,
      referenceId: opts.referenceId,
    },
  });
}

export async function notifyCustomerProfileUpdated(
  businessId: string,
  customerId: string,
  customerName: string,
  actorUserId?: string,
  summary?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(customerName, "Customer");
  await notifyManagement(businessId, {
    title: "Customer profile updated",
    message: `${actor} updated ${name}${summary ? ` — ${summary}` : ""}.`,
    type: "info",
    metadata: {
      reviewTab: "customers",
      category: "customer",
      customerId,
      customerName: name,
    },
  }, { excludeUserIds: actorUserId ? [actorUserId] : [] });
}

export async function notifyRiderProfileUpdated(
  businessId: string,
  riderId: string,
  riderName: string,
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(riderName, "Rider");
  await notifyManagement(businessId, {
    title: "Rider profile updated",
    message: `${actor} updated rider ${name}.`,
    type: "info",
    metadata: {
      reviewTab: "operations",
      category: "rider",
      riderId,
    },
  }, { excludeUserIds: actorUserId ? [actorUserId] : [] });

  await notifyRiderUser(businessId, riderId, {
    title: "Your rider profile was updated",
    message: `${actor} updated your station rider settings.`,
    type: "info",
    metadata: { category: "rider", riderId },
  });
}

export async function notifyInventoryLowStock(
  businessId: string,
  itemName: string,
  currentStock: number,
  unit: string,
  itemId?: string,
): Promise<void> {
  const name = cleanLabel(itemName, "Stock item");
  await notifyManagement(businessId, {
    title: "Restock needed",
    message: `${name} is low (${currentStock} ${unit || "units"} left).`,
    type: "warning",
    metadata: {
      reviewTab: "inventory",
      category: "inventory",
      itemId,
      itemName: name,
    },
  });
}

export async function notifyInventoryStockAdjusted(
  businessId: string,
  itemName: string,
  amount: number,
  newStock: number,
  unit: string,
  actorUserId?: string,
  itemId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(itemName, "Stock item");
  const direction = amount >= 0 ? "added" : "removed";
  const qty = Math.abs(amount);
  await notifyManagement(businessId, {
    title: "Stock adjusted",
    message:
      `${actor} ${direction} ${qty} ${unit || "units"} of ${name} ` +
      `(now ${newStock} on hand).`,
    type: "info",
    metadata: {
      reviewTab: "inventory",
      category: "inventory",
      itemId,
      itemName: name,
    },
  }, { excludeUserIds: actorUserId ? [actorUserId] : [] });
}

/** @deprecated Prefer notifyManagement — kept for gradual migration.
 * @param {string} businessId Business id.
 * @param {Omit<NotificationPayload, "userId" | "businessId">} payload Notification copy.
 * @return {Promise<void>}
 */
export async function notifyBusinessMembers(
  businessId: string,
  payload: Omit<NotificationPayload, "userId" | "businessId">,
): Promise<void> {
  await notifyManagement(businessId, payload);
}
