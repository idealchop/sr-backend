import { db, FieldValue } from "../../config/firebase-admin";
import { InventoryService } from "../inventory/inventory-service";
import { ProductService } from "../products/product-service";
import {
  getBusinessContainerDefaultPolicy,
  type ContainerDefaultPolicy,
} from "./container-policy";
import { logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import {
  customerTracksContainers,
} from "../transactions/sync-customer-asset-possession";
import {
  assignmentEventsFromOrders,
  netPossessionFromOrders,
  possessionHasPositiveQuantity,
} from "../transactions/possession-from-order-lines";
import {
  assignmentHistoryDocId,
  extraAssignmentIdsToDelete,
} from "../inventory/assignment-history";
import type { Transaction } from "../transactions/transaction-types";
import type { DeliveryProduct } from "../products/product-types";
import type { InventoryItem } from "../inventory/inventory-service";
import type { Customer } from "./customer-service";
import type { CustomerPossessionMap } from "./customer-possession-stock";

type OrderPossessionContext = {
  inventoryRows: InventoryItem[];
  products: DeliveryProduct[];
  policy: ContainerDefaultPolicy;
  transactions: Array<Transaction & { id: string }>;
};

function toJsDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const converted = (value as { toDate: () => Date }).toDate();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (value && typeof value === "object") {
    const seconds =
      "seconds" in value ?
        Number((value as { seconds?: unknown }).seconds) :
        "_seconds" in value ?
          Number((value as { _seconds?: unknown })._seconds) :
          NaN;
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return new Date();
}

async function loadOrderPossessionContext(
  businessId: string,
  customerId: string,
): Promise<OrderPossessionContext> {
  const [inventoryRows, products, businessSnap, txSnap] = await Promise.all([
    InventoryService.listItems(businessId),
    ProductService.ensureSeeded(businessId),
    db.collection("businesses").doc(businessId).get(),
    db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .where("customerId", "==", customerId)
      .get(),
  ]);
  return {
    inventoryRows,
    products,
    policy: getBusinessContainerDefaultPolicy(
      businessSnap.data() as Record<string, unknown> | undefined,
    ),
    transactions: txSnap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Transaction),
    })),
  };
}

export async function computePossessionFromFulfilledOrders(
  businessId: string,
  customerId: string,
): Promise<CustomerPossessionMap> {
  const { inventoryRows, products, policy, transactions } =
    await loadOrderPossessionContext(businessId, customerId);
  const net = netPossessionFromOrders(
    transactions,
    inventoryRows,
    products,
    policy,
  );
  const possession: CustomerPossessionMap = {};
  for (const [itemId, row] of Object.entries(net)) {
    possession[itemId] = {
      itemName: row.itemName,
      quantity: row.quantity,
      deductFromStock: false,
    };
  }
  return possession;
}

export function mergeOrderPossessionOnto(
  current: CustomerPossessionMap | undefined,
  fromOrders: CustomerPossessionMap,
): CustomerPossessionMap {
  return {
    ...(current || {}),
    ...fromOrders,
  };
}

export async function ensureAssignmentHistoryFromOrders(params: {
  businessId: string;
  customerId: string;
  customerName: string;
}): Promise<number> {
  const { businessId, customerId, customerName } = params;
  const { inventoryRows, products, policy, transactions } =
    await loadOrderPossessionContext(businessId, customerId);
  const events = assignmentEventsFromOrders(
    transactions,
    inventoryRows,
    products,
    policy,
  );
  const wantedDocIds = new Set(
    events.map((event) =>
      assignmentHistoryDocId(
        event.transactionId,
        event.inventoryItemId,
        event.movement,
      ),
    ),
  );

  for (const event of events) {
    const assignmentId = assignmentHistoryDocId(
      event.transactionId,
      event.inventoryItemId,
      event.movement,
    );
    await InventoryService.upsertAssignment(businessId, assignmentId, {
      inventoryItemId: event.inventoryItemId,
      inventoryItemName: event.inventoryItemName,
      customerId,
      customerName,
      quantityAssigned: event.quantityAssigned,
      date: toJsDate(event.occurredAt),
      transactionId: event.transactionId,
      movement: event.movement,
    });
  }

  const existing = await InventoryService.getCustomerAssignments(
    businessId,
    customerId,
    true,
  );
  const extraIds = extraAssignmentIdsToDelete(existing, wantedDocIds);
  for (const assignmentId of extraIds) {
    await InventoryService.deleteAssignment(businessId, assignmentId);
  }
  return events.length;
}

export async function applyPossessionFromFulfilledOrdersIfEmpty(params: {
  businessId: string;
  customerId: string;
  customer: Customer | null;
  userId?: string;
  userName?: string;
}): Promise<{
  applied: boolean;
  possession: CustomerPossessionMap;
}> {
  const { businessId, customerId, customer, userId, userName } = params;
  const current = (customer?.possession || {}) as CustomerPossessionMap;
  if (!customerTracksContainers(customer)) {
    return { applied: false, possession: current };
  }

  let next = current;
  let possessionChanged = false;
  if (!possessionHasPositiveQuantity(current)) {
    const fromOrders = await computePossessionFromFulfilledOrders(
      businessId,
      customerId,
    );
    if (possessionHasPositiveQuantity(fromOrders)) {
      next = mergeOrderPossessionOnto(current, fromOrders);
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId)
        .update({
          possession: next,
          updatedAt: FieldValue.serverTimestamp(),
        });
      const actor = buildAuditActorFields(userId, userName);
      await logAuditEvent(
        "POSSESSION_BACKFILLED_FROM_ORDERS",
        { businessId, customerId, ...actor },
        current,
        next,
      );
      possessionChanged = true;
    }
  }

  const historyWritten = await ensureAssignmentHistoryFromOrders({
    businessId,
    customerId,
    customerName: customer?.name || "Unknown Customer",
  });

  return {
    applied: possessionChanged || historyWritten > 0,
    possession: next,
  };
}
