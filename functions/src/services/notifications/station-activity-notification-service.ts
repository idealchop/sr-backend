import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import type { Transaction } from "../transactions/transaction-service";
import type { RawSubmissionType } from "../portal/raw-submission-types";
import type { PortalCustomerStatus } from "../portal/portal-profile-diff";
import {
  mapPortalOrderKindToSource,
  notificationTitleWithOrderSource,
  resolveTransactionOrderSource,
  type TransactionOrderSource,
} from "./transaction-order-source";
import {
  NotificationService,
  type NotificationPayload,
} from "./notification-service";
import { maybeSendCustomerTxnNotification } from "../portal/customer-transaction-notifier";

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
  const orderSource = resolveTransactionOrderSource(tx);
  return {
    reviewTab: "transactions",
    category: "transaction",
    transactionId: tx.id,
    referenceId: tx.referenceId,
    customerId: tx.customerId,
    customerName: tx.customerName,
    ...(orderSource ? { orderSource } : {}),
    ...extra,
  };
}

function portalReviewMeta(
  extra: Record<string, unknown>,
  portalOrderKind?: string,
): Record<string, unknown> {
  const orderSource = mapPortalOrderKindToSource(portalOrderKind);
  return {
    reviewTab: "submissions",
    category: "portal",
    ...(orderSource ? { orderSource } : {}),
    ...extra,
  };
}

function orderSourceToPortalKind(
  source: TransactionOrderSource,
): "delivery" | "walkin" | "collection" {
  switch (source) {
  case "qr_walkin":
    return "walkin";
  case "qr_collection":
    return "collection";
  case "qr_order":
  default:
    return "delivery";
  }
}

function prefixTitleForTransaction(
  baseTitle: string,
  tx: Partial<Transaction>,
): string {
  return notificationTitleWithOrderSource(
    baseTitle,
    resolveTransactionOrderSource(tx),
  );
}

/**
 * Owner + active management seats that receive in-app station notifications.
 * Always includes `businesses.ownerId` even when the owner member doc is missing
 * or has no explicit role (legacy workspaces).
 * @param {string} businessId Business id.
 * @return {Promise<string[]>} Distinct Firebase Auth user ids.
 */
export async function listManagementUserIds(
  businessId: string,
): Promise<string[]> {
  const [membersSnap, businessDoc] = await Promise.all([
    db.collection("businesses").doc(businessId).collection("members").get(),
    db.collection("businesses").doc(businessId).get(),
  ]);
  const ownerId = String(businessDoc.data()?.ownerId || "").trim();
  const ids = new Set<string>();
  if (ownerId) ids.add(ownerId);
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    if (data?.isActive === false) continue;
    const role = String(data?.role || "").toLowerCase();
    const memberUid = String(data?.userId || doc.id).trim();
    if (!memberUid) continue;
    if (MANAGEMENT_ROLES.has(role)) {
      ids.add(memberUid);
    }
    if (ownerId && memberUid === ownerId) {
      ids.add(ownerId);
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
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
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
): Promise<void> {
  const userIds = await listManagementUserIds(businessId);
  await sendToUsers(businessId, userIds, payload);
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
  const orderSource = resolveTransactionOrderSource(tx);

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
  case "direct_sale": {
    const baseTitle =
      orderSource === "qr_walkin" ? "Counter check-in accepted" : typeLabel;
    title = notificationTitleWithOrderSource(baseTitle, orderSource);
    message =
      orderSource === "qr_walkin" ?
        `${customer} scanned walk-in QR — ${amountLine || "completed"} (${ref}).` :
        `${customer} — ${amountLine || "completed"} (${ref}).`;
    type = "success";
    break;
  }
  case "collection": {
    const baseTitle =
      orderSource === "qr_collection" ?
        "Portal collection scheduled" :
        "Collection scheduled";
    title = notificationTitleWithOrderSource(baseTitle, orderSource);
    message =
      orderSource === "qr_collection" ?
        `${customer} requested pickup via QR — ${amountLine || "collection"} (${ref})${
          riderName ? ` · Rider: ${riderName}` : ""
        }.` :
        `${customer} — ${amountLine || "collection"} (${ref})${
          riderName ? ` · Rider: ${riderName}` : ""
        }.`;
    break;
  }
  case "delivery":
  default: {
    const baseTitle =
      orderSource === "qr_order" ?
        (tx.deliveryStatus === "placed" ? "Portal order accepted" : "QR delivery order") :
        "New delivery order";
    title = notificationTitleWithOrderSource(baseTitle, orderSource);
    message =
      orderSource === "qr_order" ?
        `${customer} ordered via QR — ${amountLine || "order"} (${ref})${
          riderName ? ` · Assigned to ${riderName}` : ""
        }.` :
        `${customer} — ${amountLine || "order"} (${ref})${
          riderName ? ` · Assigned to ${riderName}` : ""
        }.`;
    if (tx.paymentStatus === "unpaid" || tx.paymentStatus === "partial") {
      type = "warning";
    }
    break;
  }
  }

  const meta = transactionReviewMeta(tx, {
    transactionType: tx.type,
    deliveryStatus: tx.deliveryStatus,
    riderId: tx.riderId,
    ...(orderSource === "qr_order" || orderSource === "qr_walkin" ||
      orderSource === "qr_collection" ?
      { portalOrderKind: orderSourceToPortalKind(orderSource) } :
      {}),
  });

  await notifyManagement(businessId, {
    title,
    message,
    type,
    metadata: meta,
  });

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
    let title = prefixTitleForTransaction("Order status updated", after);
    let type: NotifyType = "info";
    let message = `${customer} is now ${status} (${ref})${
      riderName ? ` · ${riderName}` : ""
    }.`;

    if (
      after.deliveryStatus === "delivered" ||
      after.deliveryStatus === "collected" ||
      after.deliveryStatus === "completed"
    ) {
      title = prefixTitleForTransaction(
        after.type === "collection" ? "Collection completed" : "Delivery completed",
        after,
      );
      message = `${riderName || actor} completed ${customer} (${ref})${
        buildAmountLine(after) ? ` · ${buildAmountLine(after)}` : ""
      }.`;
      type = "success";
    } else if (
      after.deliveryStatus === "in-transit"
    ) {
      title = prefixTitleForTransaction("Rider en route", after);
      message = `${riderName || "Rider"} is on the way to ${customer} (${ref}).`;
    } else if (
      after.deliveryStatus === "failed" ||
      after.deliveryStatus === "cancelled"
    ) {
      title = prefixTitleForTransaction("Order cancelled", after);
      message = `${customer} (${ref}) was marked ${status}.`;
      type = "warning";
    }

    await notifyManagement(businessId, { title, message, type, metadata: meta });

    void maybeSendCustomerTxnNotification({
      businessId,
      transaction: { ...after, id: transactionId },
      beforeStatus: before.deliveryStatus,
    }).catch((err) => {
      logger.warn("customer_txn_notification_failed", {
        businessId,
        transactionId,
        err,
      });
    });
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
      title: prefixTitleForTransaction("Payment received", after),
      message: `${customer} paid ${formatPeso(after.totalAmount ?? 0)} (${ref}).`,
      type: "success",
      metadata: meta,
    });
  } else if (
    paymentChanged &&
    (after.paymentStatus === "partial" || after.paymentStatus === "unpaid")
  ) {
    await notifyManagement(businessId, {
      title: prefixTitleForTransaction("Balance updated", after),
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
    });
  }
}

function portalCustomerStatusLabel(status: PortalCustomerStatus | undefined): string {
  return status === "recognized" ? "recognized suki" : "new customer";
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
    portalCustomerStatus?: PortalCustomerStatus;
  },
): Promise<void> {
  const name = cleanLabel(opts.customerName, "A customer");
  const ref = opts.referenceId.trim() || "Portal request";
  const statusSuffix =
    opts.portalCustomerStatus === "recognized" ?
      " (recognized suki)" :
      opts.portalCustomerStatus === "new" ?
        " (new customer)" :
        "";
  let title = notificationTitleWithOrderSource(
    "New portal order",
    mapPortalOrderKindToSource(opts.portalOrderKind) ?? "qr_order",
  );
  let message = `${name} placed an order (${ref})${statusSuffix}.`;

  switch (opts.submissionType) {
  case "REQUEST_COLLECTION":
    title = notificationTitleWithOrderSource(
      "Collection request",
      "qr_collection",
    );
    message = `${name} requested a container pickup via QR (${ref})${statusSuffix}.`;
    break;
  case "PORTAL_PAY_BALANCE":
    title = "Portal payment";
    message = `${name} sent a balance payment (${ref})${statusSuffix}.`;
    break;
  case "MARK_TX_COMPLETE":
  case "COMPLETE_TX":
    title = "Customer marked order complete";
    message = `${name} confirmed completion (${ref})${statusSuffix}.`;
    break;
  case "PLACE_ORDER":
    if (opts.portalOrderKind === "walkin") {
      title = notificationTitleWithOrderSource("Counter check-in", "qr_walkin");
      message = `${name} scanned walk-in QR at the counter (${ref})${statusSuffix}.`;
    } else if (opts.portalOrderKind === "collection") {
      title = notificationTitleWithOrderSource(
        "Collection request",
        "qr_collection",
      );
      message = `${name} requested collection via QR (${ref})${statusSuffix}.`;
    } else {
      title = notificationTitleWithOrderSource("New delivery order", "qr_order");
      message = `${name} placed a delivery order via QR (${ref})${statusSuffix}.`;
    }
    break;
  default:
    break;
  }

  await notifyManagement(businessId, {
    title,
    message,
    type: "info",
    metadata: portalReviewMeta(
      {
        submissionId: opts.submissionId,
        customerId: opts.customerId,
        referenceId: opts.referenceId,
        ...(opts.portalOrderKind ? { portalOrderKind: opts.portalOrderKind } : {}),
        ...(opts.portalCustomerStatus ?
          { portalCustomerStatus: opts.portalCustomerStatus } :
          {}),
      },
      opts.portalOrderKind,
    ),
  });
}

/**
 * Notifies management when a recognized suki submits changed profile fields.
 * @param {string} businessId Business id.
 * @param {object} opts Notification context.
 * @return {Promise<void>}
 */
export async function notifyPortalRecognizedProfileUpdated(
  businessId: string,
  opts: {
    submissionId: string;
    customerId: string;
    customerName: string;
    referenceId: string;
    changedSummary: string;
  },
): Promise<void> {
  const name = cleanLabel(opts.customerName, "Customer");
  const ref = opts.referenceId.trim() || "Portal request";
  await notifyManagement(businessId, {
    title: "Portal profile update",
    message:
      `${name} (recognized suki) updated ${opts.changedSummary} via QR portal (${ref}).`,
    type: "info",
    metadata: {
      reviewTab: "submissions",
      category: "portal",
      submissionId: opts.submissionId,
      customerId: opts.customerId,
      referenceId: opts.referenceId,
      portalCustomerStatus: "recognized",
      portalProfileUpdated: true,
    },
  });
}

/**
 * Notifies when staff links a portal submission to an existing suki.
 * @param {string} businessId Business id.
 * @param {object} opts Notification context.
 * @param {string} [opts.actorUserId] Staff user id.
 * @return {Promise<void>}
 */
export async function notifyPortalSukiIdentified(
  businessId: string,
  opts: {
    submissionId: string;
    customerId: string;
    customerName: string;
    referenceId: string;
    changedSummary?: string;
  },
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(opts.customerName, "Customer");
  const ref = opts.referenceId.trim() || "Portal request";
  const updateLine = opts.changedSummary ?
    ` — updated ${opts.changedSummary}` :
    "";
  await notifyManagement(businessId, {
    title: "Portal suki identified",
    message: `${actor} matched ${name} to this portal request (${ref})${updateLine}.`,
    type: "info",
    metadata: {
      reviewTab: "submissions",
      category: "portal",
      submissionId: opts.submissionId,
      customerId: opts.customerId,
      referenceId: opts.referenceId,
      portalCustomerStatus: "recognized",
    },
  });
}

/**
 * Notifies when a new suki is registered from a portal submission.
 * @param {string} businessId Business id.
 * @param {object} opts Notification context.
 * @param {string} [opts.actorUserId] Staff user id.
 * @return {Promise<void>}
 */
export async function notifyPortalSukiRegistered(
  businessId: string,
  opts: {
    submissionId: string;
    customerId: string;
    customerName: string;
    referenceId: string;
  },
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(opts.customerName, "New suki");
  const ref = opts.referenceId.trim() || "Portal request";
  await notifyManagement(businessId, {
    title: "New suki from portal",
    message: `${actor} registered ${name} from a portal request (${ref}).`,
    type: "success",
    metadata: {
      reviewTab: "submissions",
      category: "portal",
      submissionId: opts.submissionId,
      customerId: opts.customerId,
      referenceId: opts.referenceId,
      portalCustomerStatus: "new",
    },
  });
}

/**
 * Notifies when a portal submission is accepted into the transaction ledger.
 * @param {string} businessId Business id.
 * @param {object} opts Notification context.
 * @param {string} [opts.actorUserId] Staff user id.
 * @return {Promise<void>}
 */
export async function notifyPortalSubmissionFulfilled(
  businessId: string,
  opts: {
    submissionId: string;
    submissionType: RawSubmissionType;
    customerId: string;
    customerName: string;
    referenceId: string;
    transactionId?: string;
    portalOrderKind?: string;
    portalCustomerStatus?: PortalCustomerStatus;
  },
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(opts.customerName, "Customer");
  const ref = opts.referenceId.trim() || "Portal request";
  const statusLabel = portalCustomerStatusLabel(opts.portalCustomerStatus);
  let title = "Portal request recorded";
  let message =
    `${actor} proceeded ${name} (${statusLabel}) to the ledger (${ref}).`;

  if (opts.submissionType === "PLACE_ORDER") {
    if (opts.portalOrderKind === "walkin") {
      title = notificationTitleWithOrderSource("Walk-in recorded", "qr_walkin");
      message =
        `${actor} recorded QR walk-in for ${name} (${statusLabel}) (${ref}).`;
    } else if (opts.portalOrderKind === "collection") {
      title = notificationTitleWithOrderSource("Collection recorded", "qr_collection");
      message =
        `${actor} recorded QR collection for ${name} (${statusLabel}) (${ref}).`;
    } else {
      title = notificationTitleWithOrderSource("Portal order recorded", "qr_order");
      message =
        `${actor} recorded QR delivery for ${name} (${statusLabel}) (${ref}).`;
    }
  } else if (opts.submissionType === "REQUEST_COLLECTION") {
    title = notificationTitleWithOrderSource("Collection recorded", "qr_collection");
    message =
      `${actor} recorded QR collection for ${name} (${statusLabel}) (${ref}).`;
  }

  await notifyManagement(businessId, {
    title,
    message,
    type: "success",
    metadata: portalReviewMeta(
      {
        submissionId: opts.submissionId,
        customerId: opts.customerId,
        referenceId: opts.referenceId,
        ...(opts.transactionId ? { transactionId: opts.transactionId } : {}),
        ...(opts.portalOrderKind ? { portalOrderKind: opts.portalOrderKind } : {}),
        ...(opts.portalCustomerStatus ?
          { portalCustomerStatus: opts.portalCustomerStatus } :
          {}),
        portalFulfilled: true,
      },
      opts.portalOrderKind,
    ),
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
  });
}

export async function notifyCustomerRemoved(
  businessId: string,
  customerId: string,
  customerName: string,
  actorUserId?: string,
): Promise<void> {
  const actor = await resolveActorLabel(businessId, actorUserId);
  const name = cleanLabel(customerName, "A customer");
  await notifyManagement(businessId, {
    title: "Customer removed",
    message: `${actor} removed ${name} from your suki list.`,
    type: "warning",
    metadata: {
      reviewTab: "customers",
      category: "customer",
      customerId,
      customerName: name,
    },
  });
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
  });

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
  });
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
