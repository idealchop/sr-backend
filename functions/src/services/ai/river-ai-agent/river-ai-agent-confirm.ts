import { randomUUID } from "crypto";
import { db, FieldValue } from "../../../config/firebase-admin";
import { CustomerService } from "../../customers/customer-service";
import { InventoryService } from "../../inventory/inventory-service";
import {
  TransactionService,
  type CollectionItem,
  type Transaction,
  type TransactionPayment,
  type TransactionRefill,
} from "../../transactions/transaction-service";
import type { RiverAiAgentConfirmResult, RiverAiAgentPendingAction } from "./river-ai-agent-types";
import { deletePendingAction } from "./river-ai-agent-pending-store";

async function resolveTransactionId(
  businessId: string,
  transactionId?: string,
  referenceId?: string,
): Promise<string | undefined> {
  if (transactionId) return transactionId;
  if (!referenceId) return undefined;
  const txs = await TransactionService.getTransactionsByBusiness(businessId, { limit: 50 });
  const match = txs.find((t) =>
    (t.referenceId || "").toLowerCase() === referenceId.toLowerCase(),
  );
  return match?.id;
}

export async function confirmRiverAiAgentAction(args: {
  businessId: string;
  userId: string;
  pending: RiverAiAgentPendingAction;
}): Promise<RiverAiAgentConfirmResult> {
  const { businessId, userId, pending } = args;
  const tool = pending.tool;
  const p = pending.payload;

  try {
    if (tool === "customer.create") {
      const created = await CustomerService.addCustomer(
        businessId,
        p as Parameters<typeof CustomerService.addCustomer>[1],
      );
      await deletePendingAction(businessId, pending.id);
      return {
        success: true,
        summary: `Customer ${created.name} created.`,
        entityIds: created.id ? [created.id] : [],
      };
    }

    if (tool === "customer.update") {
      const customerId = String(p.customerId || "");
      const updates = (p.updates || {}) as Record<string, unknown>;
      await CustomerService.updateCustomer(businessId, customerId, updates);
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Customer updated.", entityIds: [customerId] };
    }

    if (tool === "customer.set_status") {
      const customerId = String(p.customerId || "");
      await CustomerService.updateCustomer(businessId, customerId, {
        status: p.status === "inactive" ? "inactive" : "active",
      });
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Customer status updated.", entityIds: [customerId] };
    }

    if (tool === "transaction.create") {
      const waterRefills = (
        Array.isArray(p.waterRefills) ? p.waterRefills : []
      ) as TransactionRefill[];
      const paymentMethod =
        p.paymentMethod === "digital_wallet" ||
        p.paymentMethod === "bank_transfer" ||
        p.paymentMethod === "other" ?
          p.paymentMethod :
          "cash";
      const { transaction, created } = await TransactionService.addTransaction(
        businessId,
        {
          type: (p.type as Transaction["type"]) || "delivery",
          customerId: p.customerId as string | undefined,
          customerName: String(p.customerName || "Walk-in"),
          scheduledAt: p.scheduledAt as string,
          totalAmount: Number(p.totalAmount) || 0,
          amountPaid: Number(p.amountPaid) || 0,
          paymentStatus: p.paymentStatus as Transaction["paymentStatus"] | undefined,
          paymentMethod,
          deliveryStatus: (p.deliveryStatus as Transaction["deliveryStatus"]) || "pending",
          riderId: p.riderId as string | undefined,
          notes: String(p.notes || "Created via River AI"),
          waterRefills,
          items: p.items as Transaction["items"],
          clientMutationId: `river-ai-${pending.id}`,
        },
        userId,
      );
      await deletePendingAction(businessId, pending.id);
      return {
        success: true,
        summary: created ?
          `Transaction ${transaction.referenceId} created.` :
          `Transaction ${transaction.referenceId} already exists (idempotent).`,
        entityIds: transaction.id ? [transaction.id] : [],
      };
    }

    if (tool === "transaction.set_fulfillment_status") {
      const txId = await resolveTransactionId(
        businessId,
        p.transactionId as string | undefined,
        p.referenceId as string | undefined,
      );
      if (!txId) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      await TransactionService.updateTransaction(
        businessId,
        txId,
        { deliveryStatus: (p.fulfillmentStatus || p.deliveryStatus || "delivered") as Transaction["deliveryStatus"] },
        userId,
      );
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Transaction status updated.", entityIds: [txId] };
    }

    if (tool === "transaction.record_payment") {
      const txId = await resolveTransactionId(
        businessId,
        p.transactionId as string | undefined,
        p.referenceId as string | undefined,
      );
      if (!txId) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      const tx = await TransactionService.getTransaction(businessId, txId);
      if (!tx) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      const amount = Number(p.amount) || 0;
      const newPaid = (tx.amountPaid || 0) + amount;
      const total = tx.totalAmount || 0;
      const paymentStatus = newPaid >= total && total > 0 ? "paid" : newPaid > 0 ? "partial" : "unpaid";
      const payment: TransactionPayment = {
        id: randomUUID(),
        amount,
        method: (p.paymentMethod as string) || "cash",
        date: new Date().toISOString(),
      };
      const payments: TransactionPayment[] = [...(tx.payments || []), payment];
      await TransactionService.updateTransaction(
        businessId,
        txId,
        { amountPaid: newPaid, paymentStatus, payments },
        userId,
      );
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: `Payment ₱${amount} recorded.`, entityIds: [txId] };
    }

    if (tool === "transaction.assign_rider") {
      const txId = await resolveTransactionId(
        businessId,
        p.transactionId as string | undefined,
        p.referenceId as string | undefined,
      );
      if (!txId) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      await TransactionService.updateTransaction(
        businessId,
        txId,
        { riderId: String(p.riderId) },
        userId,
      );
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Rider assigned.", entityIds: [txId] };
    }

    if (tool === "transaction.report_collection_issue") {
      const txId = await resolveTransactionId(
        businessId,
        p.transactionId as string | undefined,
        p.referenceId as string | undefined,
      );
      if (!txId) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      const tx = await TransactionService.getTransaction(businessId, txId);
      if (!tx) {
        return { success: false, summary: "Transaction not found.", errors: ["NOT_FOUND"] };
      }
      const collectionItems: CollectionItem[] = [...(tx.collectionItems || [])];
      const itemName = String(p.itemName || "").toLowerCase();
      const idx = collectionItems.findIndex((i) => (i.name || "").toLowerCase().includes(itemName));
      const qtyDamaged = Number(p.qtyDamaged) || 0;
      const qtyMissing = Number(p.qtyMissing) || 0;
      if (idx >= 0) {
        const row = { ...collectionItems[idx] };
        row.qtyDamaged = (row.qtyDamaged || 0) + qtyDamaged;
        row.qtyMissing = (row.qtyMissing || 0) + qtyMissing;
        row.status = qtyDamaged > 0 ? "damaged" : qtyMissing > 0 ? "missing" : row.status;
        collectionItems[idx] = row;
      }
      await TransactionService.updateTransaction(
        businessId,
        txId,
        {
          collectionItems,
          notes: [tx.notes, String(p.notes || "")].filter(Boolean).join(" · "),
        },
        userId,
      );
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Collection issue recorded.", entityIds: [txId] };
    }

    if (tool === "inventory.adjust_stock") {
      const inventoryItemId = String(p.inventoryItemId || "");
      const delta = Number(p.delta) || 0;
      await InventoryService.adjustStock(businessId, inventoryItemId, delta, {
        reason: String(p.reason || "River AI"),
        userId,
      });
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: "Stock adjusted.", entityIds: [inventoryItemId] };
    }

    if (tool === "inventory.create") {
      const itemId = await InventoryService.createItem(
        businessId,
        p as Parameters<typeof InventoryService.createItem>[1],
      );
      await deletePendingAction(businessId, pending.id);
      return {
        success: true,
        summary: "Inventory item created.",
        entityIds: [itemId],
      };
    }

    if (tool === "catalog.upsert_water_type") {
      const ref = db.collection("businesses").doc(businessId);
      const snap = await ref.get();
      const waterTypes = [...((snap.data()?.waterTypes as unknown[]) || [])];
      const name = String(p.name);
      const price = Number(p.price) || 0;
      const id = String(p.id || name.toLowerCase().replace(/\s+/g, "_"));
      const idx = waterTypes.findIndex((w) => {
        const row = w as { id?: string; name?: string };
        return row.id === id || row.name === name;
      });
      const row = { id, name, price };
      if (idx >= 0) waterTypes[idx] = row;
      else waterTypes.push(row);
      await ref.update({ waterTypes, updatedAt: FieldValue.serverTimestamp() });
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: `Water type ${name} saved.` };
    }

    if (tool === "catalog.upsert_expense_category") {
      const ref = db.collection("businesses").doc(businessId);
      const snap = await ref.get();
      const cats = new Set<string>((snap.data()?.expenseCategories as string[]) || []);
      cats.add(String(p.name));
      await ref.update({
        expenseCategories: [...cats],
        updatedAt: FieldValue.serverTimestamp(),
      });
      await deletePendingAction(businessId, pending.id);
      return { success: true, summary: `Expense category ${String(p.name)} saved.` };
    }

    return { success: false, summary: "Unsupported action.", errors: ["UNSUPPORTED"] };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Confirm failed";
    return { success: false, summary: message, errors: [message] };
  }
}
