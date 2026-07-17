import { db, FieldValue } from "../../config/firebase-admin";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { buildAuditActorFields } from "../../utils/audit-actor";
import { RiderService } from "../riders/rider-service";
import {
  InventoryService,
  InventoryItem,
  InsufficientStockError,
  type StockDeltaApplyResult,
} from "../inventory/inventory-service";
import {
  resolveStockInventoryLineId,
  transactionSkipsSalesInventoryStock,
} from "./transaction-line-inventory";
import { CustomerLastFulfilledService } from "../customers/customer-last-fulfilled-service";
import { CustomerHealthScoreService } from "../customers/customer-health-score-service";
import { AnalyticsMaterializerService } from "../analytics/analytics-materializer-service";
import { notifyTransactionCreated } from "../notifications/station-activity-notification-service";
import {
  initialPaymentConfirmedByRider,
  initialPaymentNotesForCreate,
} from "./rider-cash-payment";
import {
  findTransactionByClientMutationId,
  normalizeClientMutationId,
} from "./client-mutation-id";
import { isUnpaidReceivableTransaction } from "../../utils/unpaid-receivable";
import { derivePaymentFields } from "./payment-status";
import {
  collectionLineStockUnits,
  isCollectionStockPhase,
} from "./transaction-stock-phases";
import {
  logCollectionContainerAudit,
  normalizeCollectionItems,
} from "./collection-item-utils";
import {
  shouldSyncWrContainerPossession,
  syncCustomerAssetPossession,
} from "./sync-customer-asset-possession";
import { getSoleActiveRiderId } from "./transaction-rider-helpers";
import { logTransactionStockAuditRows } from "./log-transaction-stock-audit";
import type {
  AddTransactionResult,
  Transaction,
} from "./transaction-types";

export async function addTransaction(
  businessId: string,
  transaction: Partial<Transaction>,
  userId?: string,
  userName?: string,
): Promise<AddTransactionResult> {
  const actor = buildAuditActorFields(userId, userName);
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
    const derived = derivePaymentFields(totalAmount, amountPaid);

    // Determine initial payment status if not provided
    let paymentStatus = transaction.paymentStatus;
    if (!paymentStatus) {
      paymentStatus = derived.paymentStatus;
    }
    const balanceDue =
      transaction.balanceDue !== undefined && transaction.balanceDue !== null ?
        Number(transaction.balanceDue) :
        derived.balanceDue;

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
      collectionItems: normalizeCollectionItems(
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

    const docRef = clientMutationId ?
      db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(clientMutationId) :
      db
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
      // (fulfilled unpaid only — pending delivery is not debt yet)
      if (
        newTransaction.customerId &&
        isUnpaidReceivableTransaction(newTransaction)
      ) {
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
      userName,
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
      { businessId, referenceId: newTransaction.referenceId, ...actor },
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
      if (await shouldSyncWrContainerPossession(businessId, customerId)) {
        await syncCustomerAssetPossession(
          businessId,
          customerId,
          newTransaction.items || [],
          newTransaction.collectionItems || [],
          docRef.id,
          userId,
          false,
          userName,
        );
        if ((newTransaction.collectionItems || []).length > 0) {
          await logCollectionContainerAudit(
            businessId,
            docRef.id,
            customerId,
            newTransaction.collectionItems || [],
            userId,
            "COLLECTION_CONTAINER_RECORDED",
            newTransaction.referenceId,
            userName,
          );
        }
      }
    }

    await CustomerLastFulfilledService.touchFromTransaction(businessId, {
      customerId: newTransaction.customerId,
      type: newTransaction.type,
      deliveryStatus: newTransaction.deliveryStatus,
      scheduledAt: newTransaction.scheduledAt,
      createdAt: newTransaction.createdAt,
    });
    CustomerHealthScoreService.scheduleRecompute(
      businessId,
      newTransaction.customerId,
    );
    AnalyticsMaterializerService.scheduleMaterialize(businessId);

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
