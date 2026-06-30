import {
  assertNoSyncConflict,
  SyncConflictError,
} from "./sync-conflict";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import {
  InventoryService,
  InventoryItem,
  InsufficientStockError,
  type StockDeltaApplyResult,
} from "../inventory/inventory-service";
import { resolveStockInventoryLineId, transactionSkipsSalesInventoryStock } from "./transaction-line-inventory";
import { CustomerLastFulfilledService } from "../customers/customer-last-fulfilled-service";
import {
  notifyTransactionCreated,
  notifyTransactionUpdated,
} from "../notifications/station-activity-notification-service";
import { syncPortalTrackLiveOnDeliveryStatus } from "../portal/portal-track-live-service";
import {
  initialPaymentConfirmedByRider,
  initialPaymentNotesForCreate,
} from "./rider-cash-payment";
import {
  findTransactionByClientMutationId,
  isIdempotentPaymentPatch,
  normalizeClientMutationId,
} from "./client-mutation-id";

export { InsufficientStockError };


export interface TransactionRefill {
  waterTypeId: string;
  name?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface TransactionInventoryItem {
  inventoryId: string;
  name?: string;
  quantity: number;
  unitPrice?: number;
  subtotal?: number;
  itemId?: string; // Added for backward compatibility
}

export interface TransactionPayment {
  id: string;
  amount: number;
  date: any;
  method: string;
  notes?: string;
  /** Cash (pay rider): treated as received unless explicitly `false`. */
  confirmedByRider?: boolean;
}

export type CollectionItemStatus =
  | "pending"
  | "ok"
  | "damaged"
  | "missing"
  | "recovered";

export interface CollectionItem {
  inventoryId: string;
  name: string;
  qtyExpected: number;
  qtyCollected: number;
  qtyOk: number;
  qtyDamaged: number;
  qtyMissing: number;
  deficitQty: number; // Current deficit (qtyExpected - qtyOk)
  status: CollectionItemStatus;
  replacedFromInventory?: boolean; // Flag to indicate if a damaged or missing item was replaced
  recoveredFromTxIds?: string[]; // IDs of past transactions this item recovered debt FROM
  recoveryLinks?: { txId: string; amount: number }[]; // Debt recovered FROM this item
  notes?: string;
}

export interface Transaction {
  id?: string;
  businessId: string;
  referenceId: string;
  type: "delivery" | "walkin" | "direct_sale" | "expense" | "collection";
  customerId?: string;
  customerName: string;
  waterRefills?: TransactionRefill[];
  items?: TransactionInventoryItem[];
  collectionItems?: CollectionItem[];
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "paid" | "partial" | "unpaid" | "N/A";
  paymentMethod: "cash" | "digital_wallet" | "bank_transfer" | "other";
  payments?: TransactionPayment[];
  deliveryStatus:
    | "pending"
    | "placed"
    | "in-transit"
    | "delivered"
    | "collected"
    | "failed"
    | "cancelled"
    | "completed";
  riderId?: string;
  /** Denormalized rider display name (set when `riderId` is assigned). */
  riderName?: string;
  linkedTransactionId?: string;
  notes?: string;
  scheduledAt?: any;
  /** Set when the stop first moves to `in-transit` (rider en route / at stop). */
  arrivedAt?: any;
  deliveredAt?: any;
  /** Manual dispatch stop order within a rider route (lower = earlier). */
  routeSequence?: number | null;
  /** Counter walk-in queue ticket for the Manila business day. */
  walkInQueueNumber?: number;
  attachmentUrl?: string;
  /**
   * Customer portal: photo of received items at completion
   * (distinct from payment transfer proof).
   */
  deliveryProofUrl?: string;
  signatureUrl?: string;
  expenseCategory?: string;
  /** @deprecated Prefer `serviceRating`; kept for legacy rows and portal backward compatibility. */
  rating?: number;
  /** Customer-rated station / fulfillment quality (1–5). */
  serviceRating?: number;
  /** Customer-rated WRS / station quality (1–5). */
  wrsRating?: number;
  /** Customer-rated rider experience when a rider was involved (1–5). */
  riderRating?: number;
  feedback?: string;
  createdAt?: any;
  updatedAt?: any;
  /** Offline outbox idempotency key (unique per business when set). */
  clientMutationId?: string;
  /**
   * When false, delivery line items have not yet been deducted from inventory
   * (deferred until the order leaves `pending`). Omitted/undefined means legacy
   * behaviour: stock was applied at transaction creation.
   */
  salesStockApplied?: boolean;
}

export type AddTransactionResult = {
  transaction: Transaction;
  created: boolean;
};

/** Delivery phases where sold line items are considered dispatched for stock. */
const DISPATCH_STOCK_PHASES = new Set<string>([
  "placed",
  "in-transit",
  "delivered",
  "completed",
  "collected",
]);

/** Phases where returned containers (qtyOk) count toward warehouse stock. */
const COLLECTION_STOCK_PHASES = new Set<string>([
  "delivered",
  "completed",
  "collected",
]);

function isDispatchStockPhase(status: string | undefined): boolean {
  return !!status && DISPATCH_STOCK_PHASES.has(status);
}

function isCollectionStockPhase(status: string | undefined): boolean {
  return !!status && COLLECTION_STOCK_PHASES.has(status);
}

/**
 * Stock returned to inventory from a collection line: serviceable units only.
 * @param {CollectionItem} item
 * @return {number}
 */
function collectionLineStockUnits(item: CollectionItem): number {
  return Math.max(0, item.qtyOk || 0);
}

function aggregateCollectionStockByInventoryId(
  items: CollectionItem[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    if (!item.inventoryId) continue;
    const units = collectionLineStockUnits(item);
    if (units === 0) continue;
    map.set(item.inventoryId, (map.get(item.inventoryId) || 0) + units);
  }
  return map;
}

function aggregateSalesQtyByInventoryId(
  items: TransactionInventoryItem[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    const invId = resolveStockInventoryLineId(item);
    if (!invId) continue;
    map.set(invId, (map.get(invId) || 0) + item.quantity);
  }
  return map;
}

// InsufficientStockError moved to inventory-service.ts

// eslint-disable-next-line valid-jsdoc
/**
 * When a business has exactly one non-inactive rider, use them as the default assignee
 * for delivery/collection dispatches (no manual rider picker needed).
 */
async function getSoleActiveRiderId(
  businessId: string,
): Promise<string | undefined> {
  try {
    const riders = await RiderService.getRidersByBusiness(businessId);
    const active = riders.filter((r) => r.status !== "inactive" && r.id);
    if (active.length === 1 && active[0].id) {
      return active[0].id;
    }
  } catch (e) {
    logger.warn("getSoleActiveRiderId failed", e);
  }
  return undefined;
}

async function syncTransactionRiderRef(
  businessId: string,
  updates: Partial<Transaction> & { riderId?: unknown; riderName?: unknown },
): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(updates, "riderId")) return;

  const raw = updates.riderId;
  if (raw === null || raw === undefined || raw === "") {
    updates.riderId = FieldValue.delete() as unknown as undefined;
    updates.riderName = FieldValue.delete() as unknown as undefined;
    return;
  }

  const linked = await RiderService.resolveRiderDocumentId(
    businessId,
    String(raw),
  );
  if (!linked) {
    throw new Error(
      "Rider assignment must reference a profile in the riders collection.",
    );
  }

  updates.riderId = linked.riderId;
  updates.riderName = linked.riderName;
}

async function logTransactionStockAuditRows(
  businessId: string,
  rows: StockDeltaApplyResult[],
  opts: {
    transactionId: string;
    referenceId?: string;
    customerId?: string;
    customerName?: string;
    auditType: "transaction_create" | "transaction_update";
    transactionType?: string;
    userId?: string;
  },
): Promise<void> {
  for (const row of rows) {
    if (!row.netDelta) continue;
    await logAuditEvent(
      "INVENTORY_ADJUSTED",
      {
        businessId,
        itemId: row.itemId,
        itemName: row.name,
        adjustment: row.netDelta,
        transactionId: opts.transactionId,
        referenceId: opts.referenceId,
        customerId: opts.customerId,
        customerName: opts.customerName,
        type: opts.auditType,
        transactionType: opts.transactionType,
        userId: opts.userId,
      },
      { currentStock: row.previousStock },
      { currentStock: row.newStock },
      opts.transactionId,
    );
  }
}

export class TransactionService {
  static async addTransaction(
    businessId: string,
    transaction: Partial<Transaction>,
    userId?: string,
  ): Promise<AddTransactionResult> {
    try {
      const clientMutationId = normalizeClientMutationId(
        transaction.clientMutationId,
      );
      if (clientMutationId) {
        const existing = await findTransactionByClientMutationId(
          businessId,
          clientMutationId,
        );
        if (existing) {
          return { transaction: existing, created: false };
        }
      }

      const timestamp = Date.now();
      const now = new Date();
      const datePart = now.toISOString().slice(2, 10).replace(/-/g, ""); // YYMMDD
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const referenceId = `TX-${datePart}-${random}`;

      const scheduledAt = transaction.scheduledAt ?
        typeof transaction.scheduledAt === "string" ?
          new Date(transaction.scheduledAt) :
          transaction.scheduledAt :
        FieldValue.serverTimestamp();

      const txType = transaction.type || "delivery";
      let resolvedRiderId = transaction.riderId;
      if (
        (txType === "delivery" || txType === "collection") &&
        !resolvedRiderId
      ) {
        resolvedRiderId = await getSoleActiveRiderId(businessId);
      }

      let resolvedRiderName: string | undefined;
      if (resolvedRiderId) {
        const linked = await RiderService.resolveRiderDocumentId(
          businessId,
          resolvedRiderId,
        );
        if (linked) {
          resolvedRiderId = linked.riderId;
          resolvedRiderName = linked.riderName;
        } else {
          resolvedRiderId = undefined;
        }
      }

      const amountPaid = transaction.amountPaid || 0;
      const totalAmount = transaction.totalAmount || 0;
      const balanceDue = totalAmount - amountPaid;

      // Determine initial payment status if not provided
      let paymentStatus = transaction.paymentStatus;
      if (!paymentStatus) {
        if (balanceDue <= 0 && totalAmount > 0) {
          paymentStatus = "paid";
        } else if (amountPaid > 0) {
          paymentStatus = "partial";
        } else {
          paymentStatus = "unpaid";
        }
      }

      // Automatically create the first payment record if amountPaid > 0 and no payments provided
      const payments = transaction.payments || [];
      if (amountPaid > 0 && payments.length === 0) {
        const payMethod = transaction.paymentMethod || "cash";
        const confirmedByRider = initialPaymentConfirmedByRider(
          payMethod,
          resolvedRiderId,
        );
        payments.push({
          id: `pay-${timestamp}-${random}`,
          amount: amountPaid,
          date: scheduledAt,
          method: payMethod,
          notes: initialPaymentNotesForCreate(payMethod, resolvedRiderId),
          ...(confirmedByRider ? { confirmedByRider } : {}),
        });
      }

      const newTransaction: Transaction = {
        businessId,
        referenceId: transaction.referenceId || referenceId,
        type: transaction.type || "delivery",
        customerId: transaction.customerId,
        customerName: transaction.customerName || (transaction.customerId ? "Unknown" : "Walk-in"),
        waterRefills: transaction.waterRefills || [],
        items: transaction.items || [],
        collectionItems: TransactionService.normalizeCollectionItems(
          transaction.collectionItems || [],
        ),
        linkedTransactionId: transaction.linkedTransactionId,
        notes: transaction.notes,
        totalAmount: totalAmount,
        amountPaid: amountPaid,
        balanceDue: balanceDue,
        paymentStatus: paymentStatus as any,
        paymentMethod: transaction.paymentMethod || "cash",
        payments: payments,
        deliveryStatus: transaction.deliveryStatus || "pending",
        riderId: resolvedRiderId,
        riderName: resolvedRiderName,
        ...(transaction.walkInQueueNumber != null ?
          { walkInQueueNumber: transaction.walkInQueueNumber } :
          {}),
        attachmentUrl: transaction.attachmentUrl,
        signatureUrl: transaction.signatureUrl,
        expenseCategory: transaction.expenseCategory,
        scheduledAt: scheduledAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(clientMutationId ? { clientMutationId } : {}),
      };

      const deferSalesInventory =
        transactionSkipsSalesInventoryStock(
          newTransaction.type,
          newTransaction.items,
        ) ||
        (newTransaction.type === "delivery" &&
          (newTransaction.deliveryStatus || "pending") === "pending");
      const applyCollectionAtCreate = isCollectionStockPhase(
        newTransaction.deliveryStatus,
      );

      (newTransaction as Transaction).salesStockApplied = deferSalesInventory ?
        false :
        true;

      const docRef = clientMutationId
        ? db
            .collection("businesses")
            .doc(businessId)
            .collection("transactions")
            .doc(clientMutationId)
        : db
            .collection("businesses")
            .doc(businessId)
            .collection("transactions")
            .doc();

      let stockApplyResults: StockDeltaApplyResult[] = [];
      let idempotentReplay: Transaction | null = null;

      // EXECUTE ATOMICALLY
      await db.runTransaction(async (t) => {
        const existingSnap = await t.get(docRef);
        if (existingSnap.exists) {
          idempotentReplay = {
            id: docRef.id,
            ...existingSnap.data(),
          } as Transaction;
          return;
        }

        // 1. Validate stock for the full commitment (sales + optional returns at create)
        const validationUpdates = new Map<
          string,
          { delta: number; name: string }
        >();
        // Expenses and walk-in refills are ledger-only; line items must not touch inventory stock.
        if (
          txType !== "expense" &&
          !transactionSkipsSalesInventoryStock(txType, newTransaction.items)
        ) {
          for (const item of newTransaction.items || []) {
            const invId = resolveStockInventoryLineId(item);
            if (!invId) continue;
            const cur = validationUpdates.get(invId) || {
              delta: 0,
              name: item.name || "Item",
            };
            cur.delta -= item.quantity;
            validationUpdates.set(invId, cur);
          }
        }
        if (applyCollectionAtCreate) {
          for (const item of newTransaction.collectionItems || []) {
            if (!item.inventoryId) continue;
            const units = collectionLineStockUnits(item);
            if (units === 0) continue;
            const cur = validationUpdates.get(item.inventoryId) || {
              delta: 0,
              name: item.name || "Item",
            };
            cur.delta += units;
            validationUpdates.set(item.inventoryId, cur);
          }
        }

        // 2. Apply inventory mutations (delivery + pending defers sales until dispatch)
        const inventoryUpdates = new Map<
          string,
          { delta: number; name: string }
        >();
        if (!deferSalesInventory) {
          for (const [invId, v] of validationUpdates.entries()) {
            inventoryUpdates.set(invId, { delta: v.delta, name: v.name });
          }
        } else if (applyCollectionAtCreate) {
          for (const item of newTransaction.collectionItems || []) {
            if (!item.inventoryId) continue;
            const units = collectionLineStockUnits(item);
            if (units === 0) continue;
            const cur = inventoryUpdates.get(item.inventoryId) || {
              delta: 0,
              name: item.name || "Item",
            };
            cur.delta += units;
            inventoryUpdates.set(item.inventoryId, cur);
          }
        }

        // Fetch and Validate Stock
        const insufficientItems: {
          id: string;
          name: string;
          available: number;
          requested: number;
        }[] = [];

        for (const [invId, update] of validationUpdates.entries()) {
          const itemRef = db
            .collection("businesses")
            .doc(businessId)
            .collection("inventory_items")
            .doc(invId);
          const itemSnap = await t.get(itemRef);

          if (!itemSnap.exists) {
            // If item doesn't exist, we can't adjust stock.
            // For now, log and skip or throw. Let's throw for safety.
            throw new Error(`Inventory item ${invId} not found`);
          }

          const itemData = itemSnap.data();
          const currentStock = itemData?.stock?.current || 0;
          const newStock = currentStock + update.delta;

          // HARD STOP: Stock cannot be negative if it's a reduction
          if (update.delta < 0 && newStock < 0) {
            insufficientItems.push({
              id: invId,
              name: itemData?.name || update.name,
              available: currentStock,
              requested: Math.abs(update.delta),
            });
          }
        }

        if (insufficientItems.length > 0) {
          throw new InsufficientStockError(insufficientItems);
        }

        const stockApplyMap = new Map<string, number>();
        for (const [invId, update] of inventoryUpdates.entries()) {
          stockApplyMap.set(invId, update.delta);
        }
        if (stockApplyMap.size > 0) {
          stockApplyResults =
            await InventoryService.applyStockDeltasInTransaction(
              t,
              businessId,
              stockApplyMap,
            );
        }

        // 2. Create the Transaction record
        t.set(docRef, newTransaction);

        // 3. Update Customer Balance Flag
        if (newTransaction.customerId && newTransaction.balanceDue > 0) {
          const customerRef = db
            .collection("businesses")
            .doc(businessId)
            .collection("customers")
            .doc(newTransaction.customerId);
          t.update(customerRef, {
            hasBalance: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      if (idempotentReplay) {
        return { transaction: idempotentReplay, created: false };
      }

      await logTransactionStockAuditRows(businessId, stockApplyResults, {
        transactionId: docRef.id,
        referenceId: newTransaction.referenceId,
        customerId: newTransaction.customerId,
        customerName: newTransaction.customerName,
        auditType: "transaction_create",
        transactionType: newTransaction.type,
        userId,
      });

      // AFTER TRANSACTION: Non-atomic side effects

      // Check for low stock alerts
      const itemsToCheck = new Set<string>();
      (newTransaction.items || []).forEach((i) => {
        const id = resolveStockInventoryLineId(i);
        if (id) itemsToCheck.add(id);
      });
      (newTransaction.collectionItems || []).forEach((i) => {
        if (i.inventoryId) itemsToCheck.add(i.inventoryId);
      });

      for (const invId of itemsToCheck) {
        try {
          const itemRef = db
            .collection("businesses")
            .doc(businessId)
            .collection("inventory_items")
            .doc(invId);
          const itemSnap = await itemRef.get();
          if (itemSnap.exists) {
            const item = {
              ...itemSnap.data(),
              id: itemSnap.id,
            } as InventoryItem;
            await InventoryService.checkLowStockAndNotify(businessId, item);
          }
        } catch (err) {
          logger.error(`Failed to check low stock for item ${invId}`, err);
        }
      }

      // Log creation
      await logAuditEvent(
        "TRANSACTION_CREATED",
        { businessId, referenceId: newTransaction.referenceId, userId },
        null,
        newTransaction,
        docRef.id,
      );

      // Possession: collection always; delivery when stock is not deferred (pending).
      const shouldSyncPossession =
        !!newTransaction.customerId &&
        (newTransaction.type === "collection" ||
          (newTransaction.type === "delivery" && !deferSalesInventory));
      if (shouldSyncPossession) {
        const customerId = newTransaction.customerId;
        if (!customerId) {
          throw new Error("Customer ID is required when syncing possession");
        }
        await TransactionService.syncCustomerAssetPossession(
          businessId,
          customerId,
          newTransaction.items || [],
          newTransaction.collectionItems || [],
          docRef.id,
          userId,
        );
        if ((newTransaction.collectionItems || []).length > 0) {
          await TransactionService.logCollectionContainerAudit(
            businessId,
            docRef.id,
            customerId,
            newTransaction.collectionItems || [],
            userId,
            "COLLECTION_CONTAINER_RECORDED",
            newTransaction.referenceId,
          );
        }
      }

      await CustomerLastFulfilledService.touchFromTransaction(businessId, {
        customerId: newTransaction.customerId,
        type: newTransaction.type,
        deliveryStatus: newTransaction.deliveryStatus,
        scheduledAt: newTransaction.scheduledAt,
        createdAt: newTransaction.createdAt,
      });

      const createdTx = { id: docRef.id, ...newTransaction };
      void notifyTransactionCreated(businessId, createdTx, userId).catch((err) => {
        logger.warn("notifyTransactionCreated failed", { businessId, err });
      });

      return { transaction: createdTx, created: true };
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw error;
      }
      logger.error("Error adding transaction", error);
      throw error;
    }
  }

  /**
   * Updates a transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {Partial<Transaction>} updates The updates.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async updateTransaction(
    businessId: string,
    transactionId: string,
    updates: Partial<Transaction>,
    userId?: string,
  ): Promise<boolean> {
    try {
      const docRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(transactionId);

      // Remove id from updates if it exists to avoid trying to update the document ID field
      if (updates.id) {
        delete (updates as any).id;
      }

      // Enforce immutability for walkin_refill and direct_sale
      const doc = await docRef.get();
      if (!doc.exists) {
        throw new Error(`Transaction ${transactionId} not found`);
      }
      const current = doc.data() as Transaction;

      assertNoSyncConflict(
        current,
        updates as Partial<Transaction> & {
          baseUpdatedAt?: unknown;
          forceApply?: boolean;
        },
        current,
      );
      delete (updates as Partial<Transaction> & { baseUpdatedAt?: unknown })
        .baseUpdatedAt;
      delete (updates as Partial<Transaction> & { forceApply?: boolean })
        .forceApply;

      if (
        updates.payments &&
        isIdempotentPaymentPatch(current, {
          payments: updates.payments,
          amountPaid: updates.amountPaid ?? current.amountPaid ?? 0,
        })
      ) {
        return false;
      }

      const effectiveType = (updates.type ?? current.type) as
        | string
        | undefined;
      if (
        (effectiveType === "delivery" || effectiveType === "collection") &&
        !Object.prototype.hasOwnProperty.call(updates, "riderId") &&
        !current.riderId
      ) {
        const sole = await getSoleActiveRiderId(businessId);
        if (sole) {
          (updates as Partial<Transaction>).riderId = sole;
        }
      }

      await syncTransactionRiderRef(businessId, updates);

      // Allow payment updates even for completed transactions
      const isCoreChange =
        updates.items !== undefined ||
        updates.totalAmount !== undefined ||
        updates.type !== undefined;

      if (
        (current.type === "walkin" || current.type === "direct_sale") &&
        current.deliveryStatus === "completed" &&
        isCoreChange
      ) {
        throw new Error(
          `Transactions of type ${current.type} are permanent. ` +
            "Items and total amount cannot be edited once completed.",
        );
      }

      if (
        updates.totalAmount !== undefined ||
        updates.amountPaid !== undefined
      ) {
        const total = updates.totalAmount ?? current.totalAmount ?? 0;
        const paid = updates.amountPaid ?? current.amountPaid ?? 0;

        // Logic to synchronize payments if amountPaid is provided but payments array is not
        if (
          updates.amountPaid !== undefined &&
          updates.payments === undefined
        ) {
          const currentPaid = current.amountPaid || 0;
          if (paid > currentPaid) {
            const delta = paid - currentPaid;
            const currentPayments = current.payments || [];

            // If it's a legacy transaction with amountPaid > 0 but no payments,
            // we should probably capture the whole amount in the first entry if it's the first time
            if (currentPayments.length === 0 && currentPaid > 0) {
              updates.payments = [
                {
                  id: `pay-init-${Date.now()}`,
                  amount: currentPaid,
                  date:
                    current.scheduledAt ||
                    current.createdAt ||
                    FieldValue.serverTimestamp(),
                  method: current.paymentMethod || "cash",
                  notes: "Initial payment (migrated)",
                },
                {
                  id: `pay-upd-${Date.now()}`,
                  amount: delta,
                  date: FieldValue.serverTimestamp(),
                  method:
                    updates.paymentMethod || current.paymentMethod || "cash",
                  notes: "Additional payment",
                },
              ];
            } else {
              updates.payments = [
                ...currentPayments,
                {
                  id: `pay-upd-${Date.now()}`,
                  amount: delta,
                  date: FieldValue.serverTimestamp(),
                  method:
                    updates.paymentMethod || current.paymentMethod || "cash",
                  notes: "Additional payment",
                },
              ];
            }
          }
        }

        updates.balanceDue = total - paid;

        if (updates.balanceDue <= 0) updates.paymentStatus = "paid";
        else if (paid > 0) updates.paymentStatus = "partial";
        else updates.paymentStatus = "unpaid";
      }

      if (updates.scheduledAt && typeof updates.scheduledAt === "string") {
        updates.scheduledAt = new Date(updates.scheduledAt);
      }

      // --- DETECT CHANGED FIELDS FOR AUDIT ---
      const changedFields: string[] = [];
      const coreFields = [
        "notes",
        "scheduledAt",
        "riderId",
        "totalAmount",
        "customerId",
        "items",
        "waterRefills",
        "collectionItems",
        "type",
        "balanceDue",
        "deliveryStatus",
        "paymentStatus",
        "amountPaid",
      ];

      for (const field of coreFields) {
        if (updates[field as keyof Transaction] !== undefined) {
          const newVal = updates[field as keyof Transaction];
          const oldVal = current[field as keyof Transaction];

          // Simple equality check for primitives, JSON stringify for objects/arrays
          if (typeof newVal === "object") {
            if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
              changedFields.push(field);
            }
          } else if (newVal !== oldVal) {
            changedFields.push(field);
          }
        }
      }

      if (updates.collectionItems !== undefined) {
        updates.collectionItems = TransactionService.normalizeCollectionItems(
          updates.collectionItems,
        );
      }

      // --- REVERSAL LOGIC FOR FAILED/CANCELLED ---
      if (
        (updates.deliveryStatus === "failed" ||
          updates.deliveryStatus === "cancelled") &&
        current.deliveryStatus !== "failed" &&
        current.deliveryStatus !== "cancelled"
      ) {
        // 1. Revert inventory and possession
        await TransactionService.reverseTransactionEffects(
          businessId,
          transactionId,
          current,
          userId,
        );

        // 2. Zero out financials and set status to N/A
        updates.totalAmount = 0;
        updates.amountPaid = 0;
        updates.balanceDue = 0;
        updates.paymentStatus = "N/A";

        // Ensure payments array is also emptied if we are zeroing out paid amount
        updates.payments = [];
      }

      // --- PREPARE UPDATES ---
      const itemsToCheck = new Set<string>();

      const nextDeliveryStatus =
        updates.deliveryStatus !== undefined ?
          updates.deliveryStatus :
          current.deliveryStatus;
      const nextCollectionItems =
        updates.collectionItems !== undefined ?
          updates.collectionItems :
          current.collectionItems || [];

      // --- EXECUTE ATOMICALLY ---
      let stockApplyResults: StockDeltaApplyResult[] = [];
      let becomingDispatched = false;
      await db.runTransaction(async (t) => {
        const skippingInventoryMutation =
          updates.deliveryStatus === "failed" ||
          updates.deliveryStatus === "cancelled";

        const finalUpdates: Record<string, unknown> = {
          ...updates,
          updatedAt: FieldValue.serverTimestamp(),
        };

        const mergeStockDelta = (
          map: Map<string, number>,
          id: string,
          delta: number,
        ) => {
          map.set(id, (map.get(id) || 0) + delta);
        };

        const stockEffectiveType = updates.type ?? current.type;
        if (
          !skippingInventoryMutation &&
          stockEffectiveType !== "expense" &&
          !transactionSkipsSalesInventoryStock(
            stockEffectiveType,
            updates.items ?? current.items,
          )
        ) {
          const stockDeltas = new Map<string, number>();
          let didDispatchSalesInventory = false;

          becomingDispatched =
            current.salesStockApplied === false &&
            isDispatchStockPhase(nextDeliveryStatus) &&
            !isDispatchStockPhase(current.deliveryStatus);

          if (becomingDispatched) {
            const lines = updates.items ?? current.items ?? [];
            const dispatchMap = aggregateSalesQtyByInventoryId(lines);
            for (const [invId, qty] of dispatchMap.entries()) {
              if (qty <= 0) continue;
              itemsToCheck.add(invId);
              mergeStockDelta(stockDeltas, invId, -qty);
            }
            didDispatchSalesInventory = true;
          }

          if (
            updates.items !== undefined &&
            !didDispatchSalesInventory &&
            current.salesStockApplied !== false
          ) {
            const oldItemsMap = new Map<string, number>();
            current.items?.forEach((item) => {
              const invId = resolveStockInventoryLineId(item);
              if (!invId) return;
              oldItemsMap.set(
                invId,
                (oldItemsMap.get(invId) || 0) + item.quantity,
              );
              itemsToCheck.add(invId);
            });

            const newItemsMap = new Map<string, number>();
            updates.items.forEach((item) => {
              const invId = resolveStockInventoryLineId(item);
              if (!invId) return;
              newItemsMap.set(
                invId,
                (newItemsMap.get(invId) || 0) + item.quantity,
              );
              itemsToCheck.add(invId);
            });

            const allItemIds = new Set([
              ...oldItemsMap.keys(),
              ...newItemsMap.keys(),
            ]);
            for (const invId of allItemIds) {
              const oldQty = oldItemsMap.get(invId) || 0;
              const newQty = newItemsMap.get(invId) || 0;
              const delta = oldQty - newQty; // If new > old, delta is negative (reduce stock)

              if (delta !== 0) {
                itemsToCheck.add(invId);
                mergeStockDelta(stockDeltas, invId, delta);
              }
            }
          }

          const prevCollStock = isCollectionStockPhase(current.deliveryStatus) ?
            aggregateCollectionStockByInventoryId(current.collectionItems) :
            new Map<string, number>();
          const nextCollStock = isCollectionStockPhase(nextDeliveryStatus) ?
            aggregateCollectionStockByInventoryId(nextCollectionItems) :
            new Map<string, number>();

          const allCollIds = new Set([
            ...prevCollStock.keys(),
            ...nextCollStock.keys(),
          ]);
          for (const invId of allCollIds) {
            const oldNet = prevCollStock.get(invId) || 0;
            const updatedNet = nextCollStock.get(invId) || 0;
            const netDelta = updatedNet - oldNet;

            if (netDelta !== 0) {
              itemsToCheck.add(invId);
              mergeStockDelta(stockDeltas, invId, netDelta);
            }
          }

          if (stockDeltas.size > 0) {
            stockApplyResults =
              await InventoryService.applyStockDeltasInTransaction(
                t,
                businessId,
                stockDeltas,
              );
          }

          if (didDispatchSalesInventory) {
            finalUpdates.salesStockApplied = true;
          }
        }

        if (
          nextDeliveryStatus === "in-transit" &&
          current.deliveryStatus !== "in-transit" &&
          !current.arrivedAt &&
          finalUpdates.arrivedAt === undefined
        ) {
          finalUpdates.arrivedAt = FieldValue.serverTimestamp();
        }

        const nextComplete =
          nextDeliveryStatus === "delivered" ||
          nextDeliveryStatus === "collected" ||
          nextDeliveryStatus === "completed";
        const wasComplete =
          current.deliveryStatus === "delivered" ||
          current.deliveryStatus === "collected" ||
          current.deliveryStatus === "completed";
        if (
          nextComplete &&
          !wasComplete &&
          !current.deliveredAt &&
          finalUpdates.deliveredAt === undefined
        ) {
          finalUpdates.deliveredAt = FieldValue.serverTimestamp();
        }

        t.update(docRef, finalUpdates as any);
      });

      await logTransactionStockAuditRows(businessId, stockApplyResults, {
        transactionId,
        referenceId: current.referenceId,
        customerId: current.customerId,
        customerName: current.customerName,
        auditType: "transaction_update",
        transactionType: current.type,
        userId,
      });

      // --- AUDIT LOGGING ---
      let hasLoggedSpecific = false;

      if (
        updates.deliveryStatus &&
        updates.deliveryStatus !== current.deliveryStatus
      ) {
        await logAuditEvent(
          "STATUS_CHANGED",
          { businessId, field: "deliveryStatus", userId },
          current.deliveryStatus,
          updates.deliveryStatus,
          transactionId,
        );
        hasLoggedSpecific = true;
        void syncPortalTrackLiveOnDeliveryStatus(businessId, {
          referenceId: current.referenceId,
          riderId: String(updates.riderId ?? current.riderId ?? ""),
          deliveryStatus: updates.deliveryStatus,
        }).catch((error) => {
          logger.warn("syncPortalTrackLiveOnDeliveryStatus failed", {
            businessId,
            transactionId,
            error,
          });
        });
      }

      if (
        updates.paymentStatus &&
        updates.paymentStatus !== current.paymentStatus
      ) {
        await logAuditEvent(
          "PAYMENT_STATUS_CHANGED",
          { businessId, field: "paymentStatus", userId },
          current.paymentStatus,
          updates.paymentStatus,
          transactionId,
        );
        hasLoggedSpecific = true;
      }

      // Check for new payments
      if (
        updates.payments &&
        updates.payments.length > (current.payments?.length || 0)
      ) {
        const currentCount = current.payments?.length || 0;
        const newPayments = updates.payments.slice(currentCount);
        for (const pay of newPayments) {
          await logAuditEvent(
            "PAYMENT_RECORDED",
            {
              businessId,
              amount: pay.amount,
              method: pay.method,
              notes: pay.notes,
              userId,
            },
            null,
            pay,
            transactionId,
          );
        }
        hasLoggedSpecific = true;
      }

      // Check for attachments/signatures
      if (
        updates.signatureUrl &&
        updates.signatureUrl !== current.signatureUrl
      ) {
        await logAuditEvent(
          "SIGNATURE_UPLOADED",
          { businessId, signatureUrl: updates.signatureUrl, userId },
          current.signatureUrl,
          updates.signatureUrl,
          transactionId,
        );
        hasLoggedSpecific = true;
      }

      if (
        updates.attachmentUrl &&
        updates.attachmentUrl !== current.attachmentUrl
      ) {
        await logAuditEvent(
          "ATTACHMENT_UPLOADED",
          { businessId, attachmentUrl: updates.attachmentUrl, userId },
          current.attachmentUrl,
          updates.attachmentUrl,
          transactionId,
        );
        hasLoggedSpecific = true;
      }

      // --- AFTER TRANSACTION: Side Effects ---

      // 1. Audit Logging
      if (changedFields.length > 0) {
        const newValues: Record<string, any> = {};
        for (const field of changedFields) {
          newValues[field] = updates[field as keyof Transaction];
        }

        await logAuditEvent(
          "TRANSACTION_UPDATED",
          { businessId, userId },
          null,
          newValues,
          transactionId,
          changedFields,
        );
      } else if (!hasLoggedSpecific && Object.keys(updates).length > 0) {
        await logAuditEvent(
          "TRANSACTION_UPDATED",
          { businessId, userId },
          null,
          updates,
          transactionId,
        );
      }

      // 2. Low Stock Alerts
      for (const invId of itemsToCheck) {
        try {
          const itemRef = db
            .collection("businesses")
            .doc(businessId)
            .collection("inventory_items")
            .doc(invId);
          const itemSnap = await itemRef.get();
          if (itemSnap.exists) {
            const item = {
              ...itemSnap.data(),
              id: itemSnap.id,
            } as InventoryItem;
            await InventoryService.checkLowStockAndNotify(businessId, item);
          }
        } catch (err) {
          logger.error(`Failed to check low stock for item ${invId}`, err);
        }
      }

      // Synchronize with Delivery if status changed to completed/delivered/collected
      if (
        ["completed", "delivered", "collected"].includes(
          updates.deliveryStatus || "",
        )
      ) {
        const deliverySnapshot = await db
          .collection("businesses")
          .doc(businessId)
          .collection("deliveries")
          .where("transactionId", "==", transactionId)
          .limit(1)
          .get();

        if (!deliverySnapshot.empty) {
          const deliveryDoc = deliverySnapshot.docs[0];
          await deliveryDoc.ref.update({
            status:
              updates.deliveryStatus === "collected" ?
                "collected" :
                "delivered",
            signatureUrl: updates.signatureUrl || null,
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      // Update customer hasBalance flag based on this and other transactions
      const customerId = updates.customerId || current.customerId;
      if (customerId) {
        const unpaidTransactions = await db
          .collection("businesses")
          .doc(businessId)
          .collection("transactions")
          .where("customerId", "==", customerId)
          .where("balanceDue", ">", 0)
          .limit(1)
          .get();

        await db
          .collection("businesses")
          .doc(businessId)
          .collection("customers")
          .doc(customerId)
          .update({
            hasBalance: !unpaidTransactions.empty,
            updatedAt: FieldValue.serverTimestamp(),
          });
      }

      // Possession on line edits, or first dispatch after pending delivery.
      const possessionSyncType = current.type;
      const itemsChanged =
        updates.items !== undefined || updates.collectionItems !== undefined;
      const shouldSyncPossession =
        customerId &&
        (possessionSyncType === "delivery" ||
          possessionSyncType === "collection") &&
        (itemsChanged || becomingDispatched);
      if (shouldSyncPossession) {
        const mergedCollection =
          updates.collectionItems ?? current.collectionItems ?? [];
        await TransactionService.syncCustomerAssetPossession(
          businessId,
          customerId,
          updates.items ?? current.items ?? [],
          mergedCollection,
          transactionId,
          userId,
        );
        if (updates.collectionItems !== undefined && mergedCollection.length > 0) {
          await TransactionService.logCollectionContainerAudit(
            businessId,
            transactionId,
            customerId,
            mergedCollection,
            userId,
            "COLLECTION_CONTAINER_UPDATED",
            current.referenceId,
          );
        }
      }

      const refreshed = await docRef.get();
      if (refreshed.exists) {
        const merged = {
          ...current,
          ...updates,
          ...refreshed.data(),
        } as Transaction;
        await CustomerLastFulfilledService.touchFromTransaction(businessId, merged);
        void notifyTransactionUpdated(
          businessId,
          transactionId,
          current,
          merged,
          userId,
          changedFields,
        ).catch((err) => {
          logger.warn("notifyTransactionUpdated failed", {
            businessId,
            transactionId,
            err,
          });
        });
      }

      return true;
    } catch (error) {
      logger.error(`Error updating transaction ${transactionId}`, error);
      throw error;
    }
  }

  /**
   * Reverses the effects of a transaction (inventory and possession).
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {Transaction} transaction The transaction data.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async reverseTransactionEffects(
    businessId: string,
    transactionId: string,
    transaction: Transaction,
    userId?: string,
  ): Promise<void> {
    const customerId = transaction.customerId;

    // 1. Revert sold items (add back to stock) when dispatch had reduced inventory
    if (
      !transactionSkipsSalesInventoryStock(transaction.type, transaction.items) &&
      transaction.salesStockApplied !== false &&
      transaction.items &&
      transaction.items.length > 0
    ) {
      for (const item of transaction.items) {
        const invId = resolveStockInventoryLineId(item);
        if (!invId) continue;
        try {
          await InventoryService.adjustStock(
            businessId,
            invId,
            item.quantity, // Positive to add back
            {
              transactionId: transactionId,
              referenceId: transaction.referenceId,
              type: "void_reversal",
              customerId: transaction.customerId,
            },
          );
        } catch (err) {
          logger.error(`Failed to revert inventory for item ${invId}`, err);
        }
      }
    }

    // 2. Revert collection returns (remove credited serviceable qty from stock)
    if (
      isCollectionStockPhase(transaction.deliveryStatus) &&
      transaction.collectionItems &&
      transaction.collectionItems.length > 0
    ) {
      for (const item of transaction.collectionItems) {
        if (!item.inventoryId) continue;
        const units = collectionLineStockUnits(item);
        if (units !== 0) {
          try {
            await InventoryService.adjustStock(
              businessId,
              item.inventoryId,
              -units,
              {
                transactionId: transactionId,
                referenceId: transaction.referenceId,
                type: "void_reversal",
                customerId: transaction.customerId,
              },
            );
          } catch (err) {
            logger.error(
              `Failed to revert collection for item ${item.inventoryId}`,
              err,
            );
          }
        }

        // REVERT FIFO RECOVERY
        if (item.recoveredFromTxIds && item.recoveredFromTxIds.length > 0) {
          for (const pastTxId of item.recoveredFromTxIds) {
            try {
              const pastTxRef = db
                .collection("businesses")
                .doc(businessId)
                .collection("transactions")
                .doc(pastTxId);
              const pastTxSnap = await pastTxRef.get();

              if (pastTxSnap.exists) {
                const pastTx = pastTxSnap.data() as Transaction;
                const pastItems = pastTx.collectionItems || [];
                let pastTxChanged = false;

                const updatedPastItems = pastItems.map((pItem) => {
                  if (
                    pItem.inventoryId !== item.inventoryId ||
                    !pItem.recoveryLinks
                  ) {
                    return pItem;
                  }

                  const linkIndex = pItem.recoveryLinks.findIndex(
                    (l) => l.txId === transactionId,
                  );

                  if (linkIndex !== -1) {
                    // Found the link. Revert it.
                    const links = pItem.recoveryLinks;
                    const link = links[linkIndex];
                    const amountToRestore = link.amount;

                    pItem.qtyOk = Math.max(0, pItem.qtyOk - amountToRestore);
                    pItem.qtyCollected = pItem.qtyOk;
                    pItem.deficitQty += amountToRestore;

                    // Remove this specific link
                    links.splice(linkIndex, 1);
                    if (links.length === 0) pItem.recoveryLinks = undefined;

                    // Re-normalize to fix status
                    const normalized =
                      TransactionService.normalizeCollectionItems([pItem])[0];
                    Object.assign(pItem, normalized);

                    pastTxChanged = true;
                  }
                  return pItem;
                });

                if (pastTxChanged) {
                  const normalized =
                    TransactionService.normalizeCollectionItems(
                      updatedPastItems,
                    );
                  await pastTxRef.update({
                    collectionItems: normalized,
                    updatedAt: FieldValue.serverTimestamp(),
                  });
                  logger.info(
                    `FIFO Reversal: Undid recovery in TX ${pastTxId} ` +
                      `for item ${item.inventoryId}`,
                  );
                }
              }
            } catch (err) {
              logger.error(
                `Failed to revert FIFO recovery in TX ${pastTxId}`,
                err,
              );
            }
          }
        }
      }
    }

    // 3. Revert customer possession
    if (customerId) {
      await TransactionService.syncCustomerAssetPossession(
        businessId,
        customerId,
        transaction.items || [],
        transaction.collectionItems || [],
        transactionId,
        userId,
        true, // isReverse
      );
    }
  }

  /**
   * Human-readable summary of a collection line (qty OK, damaged, missing, etc.).
   * @param {CollectionItem} item Collection line from a transaction.
   * @return {string} Description for logs and audit.
   */
  static describeCollectionLine(item: CollectionItem): string {
    const parts: string[] = [
      `${item.name}: expected ${item.qtyExpected}, OK ${item.qtyOk}`,
    ];
    if ((item.qtyDamaged || 0) > 0) parts.push(`damaged ${item.qtyDamaged}`);
    if ((item.qtyMissing || 0) > 0) parts.push(`missing ${item.qtyMissing}`);
    if ((item.deficitQty || 0) > 0) parts.push(`owed ${item.deficitQty}`);
    if (
      item.replacedFromInventory &&
      ((item.qtyDamaged || 0) + (item.qtyMissing || 0)) > 0
    ) {
      parts.push(
        `replaced ${(item.qtyDamaged || 0) + (item.qtyMissing || 0)} from stock`,
      );
    }
    if (item.recoveredFromTxIds?.length) {
      parts.push("recovered prior container deficit");
    }
    if (item.recoveryLinks?.length) {
      const applied = item.recoveryLinks.reduce((s, l) => s + l.amount, 0);
      parts.push(`${applied} applied to older owed qty`);
    }
    return parts.join("; ");
  }

  static async logCollectionContainerAudit(
    businessId: string,
    transactionId: string,
    customerId: string,
    collectionItems: CollectionItem[],
    userId: string | undefined,
    event: string,
    referenceId?: string,
  ): Promise<void> {
    if (!collectionItems.length) return;
    const containerLines = collectionItems.map((i) =>
      TransactionService.describeCollectionLine(i),
    );
    await logAuditEvent(
      event,
      {
        businessId,
        customerId,
        userId,
        referenceId,
        summary: containerLines.join(" | "),
        containerLines,
      },
      null,
      { collectionItems },
      transactionId,
    );
  }

  static async syncCustomerAssetPossession(
    businessId: string,
    customerId: string,
    deliveryItems: TransactionInventoryItem[] = [],
    collectionItems: CollectionItem[] = [],
    transactionId: string,
    userId?: string,
    isReverse = false,
  ): Promise<void> {
    try {
      const dItems = Array.isArray(deliveryItems) ? deliveryItems : [];
      const cItems = Array.isArray(collectionItems) ? collectionItems : [];

      if (dItems.length === 0 && cItems.length === 0) return;

      const customerRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId);

      const customerSnap = await customerRef.get();
      if (!customerSnap.exists) {
        logger.warn(
          `syncCustomerAssetPossession: customer ${customerId} not found`,
        );
        return;
      }

      const data = customerSnap.data();
      const customerName = data?.name || "Unknown Customer";
      const currentPossession = data?.possession || {};
      const updatedPossession = JSON.parse(JSON.stringify(currentPossession));
      let changed = false;

      const updatedCollectionItems = [...cItems];

      const getOrCreate = (id: string, name: string) => {
        if (!updatedPossession[id]) {
          updatedPossession[id] = {
            itemName: name || "Unknown Item",
            quantity: 0,
          };
        }
        return updatedPossession[id];
      };

      // 1. DELIVERY: add containers to customer possession first
      for (const item of dItems) {
        const invId = resolveStockInventoryLineId(item);
        if (!invId || !item.quantity || item.quantity <= 0) continue;

        const pItem = getOrCreate(invId, item.name || "");
        const prevTotal = pItem.quantity || 0;

        if (isReverse) {
          pItem.quantity = Math.max(0, prevTotal - item.quantity);
        } else {
          pItem.quantity = prevTotal + item.quantity;
        }

        if (pItem.quantity !== prevTotal) {
          changed = true;
          const delta = isReverse ? -item.quantity : item.quantity;
          await InventoryService.createAssignment(businessId, {
            inventoryItemId: invId,
            inventoryItemName: item.name || "Unknown Item",
            customerId,
            customerName,
            quantityAssigned: delta,
            date: FieldValue.serverTimestamp(),
            transactionId,
          });
        }
      }

      // 2. COLLECTION: return OK units reduce possession; replacements adjust possession + stock
      for (let i = 0; i < updatedCollectionItems.length; i++) {
        const item = updatedCollectionItems[i];
        if (!item.inventoryId) continue;

        const pItem = getOrCreate(item.inventoryId, item.name);
        const prevTotal = pItem.quantity || 0;

        const qtyReturned = item.qtyOk || 0;
        const qtyReplaced = item.replacedFromInventory ?
          (item.qtyDamaged || 0) + (item.qtyMissing || 0) :
          0;

        const netPossessionChange = qtyReplaced - qtyReturned;

        if (netPossessionChange !== 0) {
          const delta = isReverse ? -netPossessionChange : netPossessionChange;
          if (isReverse) {
            pItem.quantity = Math.max(0, prevTotal - netPossessionChange);
          } else {
            pItem.quantity = Math.max(0, prevTotal + netPossessionChange);
          }
          if (pItem.quantity !== prevTotal) {
            changed = true;
            await InventoryService.createAssignment(businessId, {
              inventoryItemId: item.inventoryId,
              inventoryItemName: item.name || "Unknown Item",
              customerId,
              customerName,
              quantityAssigned: delta,
              date: FieldValue.serverTimestamp(),
              transactionId,
            });
          }
        }

        if (!isReverse && qtyReplaced > 0) {
          try {
            await InventoryService.adjustStock(
              businessId,
              item.inventoryId,
              -qtyReplaced,
              {
                transactionId,
                customerId,
                customerName,
                reason: "COLLECTION_REPLACEMENT_FROM_STOCK",
                type: "deduction",
                summary: TransactionService.describeCollectionLine(item),
                itemName: item.name,
              },
            );
          } catch (err) {
            logger.error(
              `Replacement stock deduct failed for ${item.inventoryId}`,
              err,
            );
          }
        }

        // --- FIFO DEBT RECOVERY (Only on record, not on reversal) ---
        if (!isReverse && item.qtyOk > 0) {
          let remainingQtyOk = item.qtyOk;
          const recoveredFromTxIds: string[] = [];

          // Query past transactions with deficits for this customer
          const pastTransactionsSnap = await db
            .collection("businesses")
            .doc(businessId)
            .collection("transactions")
            .where("customerId", "==", customerId)
            .where("deliveryStatus", "in", [
              "delivered",
              "collected",
              "completed",
            ])
            .orderBy("createdAt", "asc")
            .get();

          for (const doc of pastTransactionsSnap.docs) {
            if (doc.id === transactionId) continue; // Skip current
            if (remainingQtyOk <= 0) break;

            const txData = doc.data() as Transaction;
            if (!txData.collectionItems) continue;

            let txChanged = false;
            const normalizedItems = TransactionService.normalizeCollectionItems(
              txData.collectionItems,
            );

            for (const pastItem of normalizedItems) {
              if (
                pastItem.inventoryId === item.inventoryId &&
                pastItem.deficitQty > 0
              ) {
                const recoveryAmount = Math.min(
                  remainingQtyOk,
                  pastItem.deficitQty,
                );
                pastItem.qtyOk += recoveryAmount;
                pastItem.qtyCollected = pastItem.qtyOk; // Keep sync

                // Track the recovery link
                if (!pastItem.recoveryLinks) pastItem.recoveryLinks = [];
                pastItem.recoveryLinks.push({
                  txId: transactionId,
                  amount: recoveryAmount,
                });

                pastItem.deficitQty -= recoveryAmount;

                // Re-normalize this single item to update status
                const updatedPastItem =
                  TransactionService.normalizeCollectionItems([pastItem])[0];
                Object.assign(pastItem, updatedPastItem);

                remainingQtyOk -= recoveryAmount;
                txChanged = true;
                if (!recoveredFromTxIds.includes(doc.id)) {
                  recoveredFromTxIds.push(doc.id);
                }

                const pastRef =
                  (doc.data() as Transaction).referenceId || doc.id;
                await logAuditEvent(
                  "COLLECTION_DEFICIT_RECOVERED",
                  {
                    businessId,
                    customerId,
                    userId,
                    itemName: item.name,
                    inventoryId: item.inventoryId,
                    recoveredAmount: recoveryAmount,
                    recoveredFromTransactionId: doc.id,
                    summary:
                      `${recoveryAmount}× ${item.name} applied to prior owed qty ` +
                      `(from ${pastRef})`,
                  },
                  null,
                  { deficitQty: pastItem.deficitQty },
                  transactionId,
                );

                if (remainingQtyOk <= 0) break;
              }
            }

            if (txChanged) {
              await doc.ref.update({
                collectionItems: normalizedItems,
                updatedAt: FieldValue.serverTimestamp(),
              });
              logger.info(
                `FIFO Recovery: Resolved deficit in TX ${doc.id} ` +
                  `for item ${item.inventoryId}`,
              );
            }
          }

          if (recoveredFromTxIds.length > 0) {
            item.recoveredFromTxIds = recoveredFromTxIds;
          }
        }
      }

      // Save Customer Possession
      if (changed) {
        await customerRef.update({
          possession: updatedPossession,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await logAuditEvent(
          "POSSESSION_UPDATED",
          { businessId, customerId, userId },
          currentPossession,
          updatedPossession,
          transactionId,
        );
      }

      // Update current transaction with recoveredFromTxIds if any
      const hasRecoveredLinks = updatedCollectionItems.some(
        (i) => i.recoveredFromTxIds && i.recoveredFromTxIds.length > 0,
      );
      if (hasRecoveredLinks) {
        await db
          .collection("businesses")
          .doc(businessId)
          .collection("transactions")
          .doc(transactionId)
          .update({
            collectionItems: updatedCollectionItems,
            updatedAt: FieldValue.serverTimestamp(),
          });
      }
    } catch (err) {
      logger.error(
        `[syncCustomerAssetPossession] Failed for customer ${customerId}`,
        err,
      );
    }
  }

  /**
   * Normalizes collection items by calculating deficitQty and status hierarchy.
   * @param {CollectionItem[]} items The items to normalize.
   * @return {CollectionItem[]} The normalized items.
   */
  static normalizeCollectionItems(items: CollectionItem[]): CollectionItem[] {
    return items.map((item) => {
      const qtyOk = item.qtyOk || 0;
      const qtyExpected = item.qtyExpected || 0;
      const deficitQty = Math.max(0, qtyExpected - qtyOk);
      let qtyDamaged = item.qtyDamaged || 0;
      let qtyMissing = item.qtyMissing || 0;

      // Auto-fill qtyDamaged/qtyMissing if status was explicitly set but qtys were not
      if (item.status === "damaged" && qtyDamaged === 0 && deficitQty > 0) {
        qtyDamaged = deficitQty;
      }
      if (item.status === "missing" && qtyMissing === 0 && deficitQty > 0) {
        qtyMissing = deficitQty;
      }

      let status: CollectionItemStatus = "ok";
      if (qtyOk > qtyExpected) {
        status = "recovered";
      } else if (qtyDamaged > 0) {
        status = "damaged";
      } else if (qtyMissing > 0 || deficitQty > 0) {
        status = "missing";
      } else if (qtyOk === qtyExpected) {
        status = "ok";
      }

      const normalizedItem: CollectionItem = {
        ...item,
        qtyOk,
        qtyDamaged,
        qtyMissing,
        qtyCollected: qtyOk, // Forced sync: qtyCollected always equals qtyOk
        deficitQty,
        status,
        replacedFromInventory:
          item.replacedFromInventory ?? (qtyDamaged > 0 || qtyMissing > 0),
      };

      return normalizedItem;
    });
  }

  /**
   * Gets all transactions for a business with optional filters.
   * @param {string} businessId The business ID.
   * @param {Object} options Optional query options.
   */
  static async getTransactionsByBusiness(
    businessId: string,
    options: {
      limit?: number;
      offset?: number;
      customerId?: string;
      startDate?: string;
      endDate?: string;
      orderBy?: "scheduledAt" | "createdAt";
    } = {},
  ): Promise<Transaction[]> {
    try {
      const orderField = options.orderBy ?? "scheduledAt";
      let query = db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .orderBy(orderField, "desc");

      if (options.customerId) {
        query = query.where("customerId", "==", options.customerId);
      }
      if (options.startDate) {
        query = query.where("scheduledAt", ">=", new Date(options.startDate));
      }
      if (options.endDate) {
        query = query.where("scheduledAt", "<=", new Date(options.endDate));
      }

      query = query.limit(options.limit ?? 100);
      if (options.offset) query = query.offset(options.offset);

      const snapshot = await query.get();
      return snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as Transaction,
      );
    } catch (error) {
      logger.error(
        `Error fetching transactions for business ${businessId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Gets a single transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   */
  static async getTransaction(
    businessId: string,
    transactionId: string,
  ): Promise<Transaction | null> {
    try {
      const doc = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(transactionId)
        .get();

      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Transaction;
    } catch (error) {
      logger.error(`Error getting transaction ${transactionId}`, error);
      throw error;
    }
  }

  /**
   * Gets the audit history for a specific transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   */
  static async getTransactionHistory(
    businessId: string,
    transactionId: string,
  ): Promise<any[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("audit_logs")
        .where("transactionId", "==", transactionId)
        .orderBy("timestamp", "desc")
        .get();

      return snapshot.docs.map((doc) => {
        const data = doc.data();
        // Fallback for older logs where 'event' wasn't a separate field
        let event = data.event;
        if (!event && data.message && data.message.startsWith("AUDIT: ")) {
          event = data.message.substring(7);
        } else if (
          !event &&
          data.message &&
          data.message.startsWith("SECURITY: ")
        ) {
          event = data.message.substring(10);
        }

        return {
          id: doc.id,
          ...data,
          event: event || "UNKNOWN_EVENT",
          // Convert Firestore timestamp to JS Date if it exists
          timestamp: data.timestamp?.toDate ?
            data.timestamp.toDate() :
            data.timestamp,
        };
      });
    } catch (error) {
      logger.error(
        `Error fetching history for transaction ${transactionId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Deletes a transaction record.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async deleteTransaction(
    businessId: string,
    transactionId: string,
    userId?: string,
  ): Promise<void> {
    try {
      const docRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(transactionId);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        throw new Error(`Transaction ${transactionId} not found`);
      }

      const transaction = snapshot.data() as Transaction;
      const customerId = transaction.customerId;

      // Revert inventory and possession
      await TransactionService.reverseTransactionEffects(
        businessId,
        transactionId,
        transaction,
        userId,
      );

      // Finally delete the record
      await docRef.delete();

      // Log deletion
      await logAuditEvent(
        "TRANSACTION_DELETED",
        { businessId, referenceId: transaction.referenceId, userId },
        transaction,
        null,
        transactionId,
      );

      // Update customer hasBalance flag after deletion
      if (customerId) {
        try {
          const unpaidTransactions = await db
            .collection("businesses")
            .doc(businessId)
            .collection("transactions")
            .where("customerId", "==", customerId)
            .where("balanceDue", ">", 0)
            .limit(1)
            .get();

          await db
            .collection("businesses")
            .doc(businessId)
            .collection("customers")
            .doc(customerId)
            .update({
              hasBalance: !unpaidTransactions.empty,
              updatedAt: FieldValue.serverTimestamp(),
            });
        } catch (err) {
          // Log but don't fail the deletion if customer update fails (e.g. missing index)
          logger.warn(
            `Could not update hasBalance for customer ${customerId}`,
            err,
          );
        }
      }
    } catch (error) {
      logger.error(`Error deleting transaction ${transactionId}`, error);
      throw error;
    }
  }
}
