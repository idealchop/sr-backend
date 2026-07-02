import { db } from "../../../config/firebase-admin";
import { CustomerService } from "../../customers/customer-service";
import { InventoryService } from "../../inventory/inventory-service";
import { RiderService } from "../../riders/rider-service";
import type {
  RiverAiAgentPendingAction,
  RiverAiAgentTransactionSubtype,
} from "./river-ai-agent-types";
import { resolveCustomerId } from "./river-ai-agent-read-tools";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function preview(
  title: string,
  summary: string,
  fields: RiverAiAgentPendingAction["preview"]["fields"],
  warnings?: string[],
): RiverAiAgentPendingAction["preview"] {
  return { title, summary, fields, warnings };
}

async function resolveRiderId(businessId: string, hint?: string): Promise<string | undefined> {
  const riders = await RiderService.getRidersByBusiness(businessId);
  const active = riders.filter((r) => r.status !== "inactive" && r.id);
  if (!hint) return active.length === 1 ? active[0].id : undefined;
  const q = hint.toLowerCase();
  const match = active.find((r) => (r.name || "").toLowerCase().includes(q));
  return match?.id;
}

function mapSubtypeToType(
  subtype: RiverAiAgentTransactionSubtype,
): "delivery" | "walkin" | "direct_sale" | "expense" | "collection" {
  if (subtype === "walkin_with_direct_sale") return "walkin";
  return subtype;
}

export async function buildWriteDraft(args: {
  businessId: string;
  tool: RiverAiAgentPendingAction["tool"];
  parameters: Record<string, unknown>;
}): Promise<{ payload: Record<string, unknown>; preview: RiverAiAgentPendingAction["preview"] } | null> {
  const { businessId, tool, parameters: p } = args;

  if (tool === "customer.create") {
    const name = str(p.name || p.customerName);
    if (!name) return null;
    const payload = {
      name,
      phone: str(p.phone || p.customerPhone) || "",
      address: str(p.address) || "",
      type: p.type === "commercial" ? "commercial" : "residential",
      isDeliveryEnabled: p.isDeliveryEnabled !== false,
      isCollectionEnabled: Boolean(p.isCollectionEnabled),
    };
    return {
      payload,
      preview: preview("Add customer", `Create suki ${name}`, [
        { label: "Name", value: name },
        { label: "Phone", value: payload.phone || "—" },
        { label: "Address", value: payload.address || "—" },
      ]),
    };
  }

  if (tool === "customer.update") {
    const customers = await CustomerService.getCustomersByBusiness(businessId);
    const resolved = resolveCustomerId(customers, str(p.customerName || p.name));
    const customerId = str(p.customerId) || resolved.customerId;
    if (!customerId) return null;
    const updates: Record<string, unknown> = {};
    if (str(p.phone)) updates.phone = str(p.phone);
    if (str(p.address)) updates.address = str(p.address);
    if (str(p.name)) updates.name = str(p.name);
    if (Object.keys(updates).length === 0) return null;
    return {
      payload: { customerId, updates },
      preview: preview("Update customer", `Update suki ${str(p.customerName) || customerId}`, Object.entries(updates).map(([k, v]) => ({
        label: k,
        value: String(v),
      }))),
    };
  }

  if (tool === "customer.set_status") {
    const customers = await CustomerService.getCustomersByBusiness(businessId);
    const resolved = resolveCustomerId(customers, str(p.customerName || p.name));
    const customerId = str(p.customerId) || resolved.customerId;
    const status = p.status === "inactive" ? "inactive" : "active";
    if (!customerId) return null;
    return {
      payload: { customerId, status },
      preview: preview("Customer status", `Set ${status}`, [
        { label: "Customer", value: str(p.customerName) || customerId },
        { label: "Status", value: status },
      ]),
    };
  }

  if (tool === "transaction.create") {
    const subtype = (str(p.subtype) || "delivery") as RiverAiAgentTransactionSubtype;
    const type = mapSubtypeToType(subtype);
    const customers = await CustomerService.getCustomersByBusiness(businessId);
    const customerName = str(p.customerName || p.name) || (type === "walkin" ? "Walk-in" : undefined);
    let customerId = str(p.customerId);
    if (!customerId && customerName && type !== "walkin") {
      customerId = resolveCustomerId(customers, customerName).customerId;
    }
    const qty = Math.max(1, Math.round(num(p.quantity || p.qty || p.gallons) || 1));
    const unitPrice = num(p.unitPrice || p.price);
    const totalAmount = num(p.totalAmount || p.amount) ?? (unitPrice != null ? unitPrice * qty : 0);
    const snap = await db.collection("businesses").doc(businessId).get();
    const waterTypes =
      (snap.data()?.waterTypes as Array<{ id?: string; name?: string; price?: number }>) || [];
    const defaultWater = waterTypes[0];
    const waterName = str(p.waterType) || defaultWater?.name || "Refill";
    const waterTypeId = String(defaultWater?.id || defaultWater?.name || waterName);
    const unitPriceResolved = unitPrice ?? defaultWater?.price ?? 0;
    const scheduledAt = str(p.scheduledAt || p.date) || new Date().toISOString();

    const payload: Record<string, unknown> = {
      type,
      subtype,
      customerId,
      customerName: customerName || "Walk-in",
      scheduledAt,
      totalAmount,
      amountPaid: p.paymentStatus === "paid" || p.paid === true ? totalAmount : num(p.amountPaid) || 0,
      paymentStatus: p.paymentStatus === "paid" ? "paid" : p.paymentStatus === "partial" ? "partial" : "unpaid",
      paymentMethod: str(p.paymentMethod) || "cash",
      notes: str(p.notes) || `Created via River AI (${subtype})`,
      waterRefills: [
        {
          waterTypeId,
          name: waterName,
          quantity: qty,
          unitPrice: unitPriceResolved,
          subtotal: unitPriceResolved * qty,
        },
      ],
      deliveryStatus: type === "expense" ? "completed" : p.deliveryStatus || "pending",
    };

    if (subtype === "walkin_with_direct_sale" && Array.isArray(p.inventoryItems)) {
      payload.items = p.inventoryItems;
    }

    const riderId = await resolveRiderId(businessId, str(p.riderName));
    if (riderId) payload.riderId = riderId;

    return {
      payload,
      preview: preview(
        type === "expense" ? "Record expense" : `New ${subtype.replace(/_/g, " ")}`,
        type === "expense" ?
          `${str(p.notes) || "Expense"} · ₱${totalAmount}` :
          `${customerName || "Walk-in"} · ${qty} gal · ₱${totalAmount}`,
        [
          { label: "Type", value: subtype },
          { label: type === "expense" ? "Date" : "Schedule", value: scheduledAt.slice(0, 10) },
          { label: "Payment", value: String(payload.paymentStatus) },
        ],
        !customerId && type !== "walkin" && type !== "expense" ?
          ["Customer not matched — confirm or edit before saving."] :
          undefined,
      ),
    };
  }

  if (tool === "transaction.set_fulfillment_status") {
    const status = str(p.fulfillmentStatus || p.status) || "delivered";
    const transactionId = str(p.transactionId);
    const referenceId = str(p.referenceId);
    if (!transactionId && !referenceId) return null;
    return {
      payload: { transactionId, referenceId, fulfillmentStatus: status },
      preview: preview("Update status", `Mark ${status}`, [
        { label: "Reference", value: referenceId || transactionId || "—" },
        { label: "Status", value: status },
      ]),
    };
  }

  if (tool === "transaction.record_payment") {
    const amount = num(p.amount || p.paymentAmount);
    if (amount == null || amount <= 0) return null;
    return {
      payload: {
        transactionId: str(p.transactionId),
        referenceId: str(p.referenceId),
        amount,
        paymentMethod: str(p.paymentMethod) || "cash",
      },
      preview: preview("Record payment", `₱${amount}`, [
        { label: "Reference", value: str(p.referenceId) || str(p.transactionId) || "—" },
        { label: "Amount", value: `₱${amount}` },
      ]),
    };
  }

  if (tool === "transaction.assign_rider") {
    const riderId = await resolveRiderId(businessId, str(p.riderName || p.rider));
    if (!riderId) return null;
    return {
      payload: {
        transactionId: str(p.transactionId),
        referenceId: str(p.referenceId),
        riderId,
        riderName: str(p.riderName),
      },
      preview: preview("Assign rider", str(p.riderName) || riderId, [
        { label: "Rider", value: str(p.riderName) || riderId },
        { label: "Reference", value: str(p.referenceId) || str(p.transactionId) || "—" },
      ]),
    };
  }

  if (tool === "transaction.report_collection_issue") {
    const qtyDamaged = Math.max(0, Math.round(num(p.qtyDamaged || p.damaged) || 0));
    const qtyMissing = Math.max(0, Math.round(num(p.qtyMissing || p.missing) || 0));
    if (qtyDamaged + qtyMissing <= 0) return null;
    return {
      payload: {
        transactionId: str(p.transactionId),
        referenceId: str(p.referenceId),
        inventoryItemId: str(p.inventoryItemId),
        itemName: str(p.itemName),
        qtyDamaged,
        qtyMissing,
        notes: str(p.notes),
      },
      preview: preview("Report return issue", str(p.itemName) || "Container", [
        { label: "Damaged", value: String(qtyDamaged) },
        { label: "Missing", value: String(qtyMissing) },
      ]),
    };
  }

  if (tool === "inventory.adjust_stock") {
    const itemName = str(p.itemName || p.name);
    const items = await InventoryService.listItems(businessId);
    const item = items.find((i) => i.name.toLowerCase().includes((itemName || "").toLowerCase()));
    const delta = num(p.delta || p.adjustment || p.qty);
    if (!item?.id || delta == null || delta === 0) return null;
    return {
      payload: { inventoryItemId: item.id, delta, reason: str(p.reason) || "River AI adjust" },
      preview: preview("Adjust stock", item.name, [
        { label: "Item", value: item.name },
        { label: "Change", value: delta > 0 ? `+${delta}` : String(delta) },
      ]),
    };
  }

  if (tool === "inventory.create") {
    const name = str(p.name);
    const categoryId = str(p.categoryId || p.category) || "general";
    if (!name) return null;
    return {
      payload: {
        name,
        categoryId,
        stock: { current: num(p.stock) || 0, min: num(p.minStock) || 0 },
        cost: num(p.cost) || 0,
      },
      preview: preview("Add inventory", name, [
        { label: "Category", value: categoryId },
        { label: "Stock", value: String(num(p.stock) || 0) },
      ]),
    };
  }

  if (tool === "catalog.upsert_water_type") {
    const name = str(p.name || p.waterType);
    const price = num(p.price) ?? 0;
    if (!name) return null;
    return {
      payload: { name, price, id: str(p.id) },
      preview: preview("Water type", name, [{ label: "Price", value: `₱${price}` }]),
    };
  }

  if (tool === "catalog.upsert_expense_category") {
    const name = str(p.name || p.category);
    if (!name) return null;
    return {
      payload: { name },
      preview: preview("Expense category", name, [{ label: "Name", value: name }]),
    };
  }

  return null;
}
