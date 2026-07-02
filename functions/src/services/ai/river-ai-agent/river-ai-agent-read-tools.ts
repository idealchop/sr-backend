import { db } from "../../../config/firebase-admin";
import { CustomerService } from "../../customers/customer-service";
import { InventoryService } from "../../inventory/inventory-service";
import { TransactionService } from "../../transactions/transaction-service";
import type { RiverAiAgentListRow } from "./river-ai-agent-types";

function norm(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .trim();
}

function includesText(hay: string, needle: string): boolean {
  if (!needle) return true;
  return hay.includes(needle);
}

export function matchCustomerByHint(
  customers: Awaited<ReturnType<typeof CustomerService.getCustomersByBusiness>>,
  hint?: string,
): typeof customers {
  const q = norm(hint);
  if (!q) return customers;
  return customers.filter((c) => {
    const blob = [c.name, c.phone, c.address, c.companyName].map(norm).join(" ");
    return includesText(blob, q);
  });
}

export function resolveCustomerId(
  customers: Awaited<ReturnType<typeof CustomerService.getCustomersByBusiness>>,
  hint?: string,
): { customerId?: string; matches: typeof customers } {
  const matches = matchCustomerByHint(customers, hint).slice(0, 8);
  if (matches.length === 1 && matches[0].id) {
    return { customerId: matches[0].id, matches };
  }
  return { matches };
}

export async function listCustomersForAgent(
  businessId: string,
  params: Record<string, unknown>,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const all = await CustomerService.getCustomersByBusiness(businessId);
  let filtered = [...all];

  const search = norm(params.search || params.name || params.customerName);
  if (search) {
    filtered = matchCustomerByHint(filtered, search);
  }

  const status = norm(params.status);
  if (status === "active" || status === "inactive") {
    filtered = filtered.filter((c) => (c.status || "active") === status);
  }

  if (params.hasBalance === true) {
    filtered = filtered.filter((c) => c.hasBalance === true);
  }

  const limit = Math.min(25, Math.max(1, Number(params.limit) || 15));
  const total = filtered.length;
  const slice = filtered.slice(0, limit);

  const rows: RiverAiAgentListRow[] = slice.map((c) => ({
    id: c.id || "",
    label: c.name,
    sublabel: [c.phone, c.address].filter(Boolean).join(" · "),
    meta: {
      status: c.status || "active",
      hasBalance: Boolean(c.hasBalance),
    },
  }));

  return { rows, total };
}

function customerToRow(c: Awaited<ReturnType<typeof CustomerService.getCustomersByBusiness>>[number]): RiverAiAgentListRow {
  return {
    id: c.id || "",
    label: c.name,
    sublabel: [c.phone, c.address].filter(Boolean).join(" · "),
    meta: {
      status: c.status || "active",
      hasBalance: Boolean(c.hasBalance),
    },
  };
}

export async function getCustomerForAgent(
  businessId: string,
  params: Record<string, unknown>,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const all = await CustomerService.getCustomersByBusiness(businessId);
  const customerId = typeof params.customerId === "string" ? params.customerId : undefined;
  if (customerId) {
    const one = all.find((c) => c.id === customerId);
    if (!one) return { rows: [], total: 0 };
    return { rows: [customerToRow(one)], total: 1 };
  }

  const hint = String(params.search || params.name || params.customerName || "");
  const { customerId: resolvedId, matches } = resolveCustomerId(all, hint);
  if (resolvedId && matches[0]) {
    return { rows: [customerToRow(matches[0])], total: 1 };
  }
  if (matches.length > 1) {
    const rows = matches.map(customerToRow);
    return { rows, total: rows.length };
  }
  if (hint) {
    return { rows: [], total: 0 };
  }

  return listCustomersForAgent(businessId, params);
}

export async function listTransactionsForAgent(
  businessId: string,
  params: Record<string, unknown>,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const customers = await CustomerService.getCustomersByBusiness(businessId);
  let customerId = typeof params.customerId === "string" ? params.customerId : undefined;
  if (!customerId && params.customerName) {
    const resolved = resolveCustomerId(customers, String(params.customerName));
    if (resolved.customerId) customerId = resolved.customerId;
  }

  const txs = await TransactionService.getTransactionsByBusiness(businessId, {
    limit: 200,
    customerId,
    startDate: typeof params.startDate === "string" ? params.startDate : undefined,
    endDate: typeof params.endDate === "string" ? params.endDate : undefined,
  });

  let filtered = [...txs];
  const type = norm(params.type || params.transactionType);
  if (type) {
    filtered = filtered.filter((t) => norm(t.type) === type || norm(t.type).includes(type));
  }

  const fulfillment = norm(params.fulfillmentStatus || params.status || params.deliveryStatus);
  if (fulfillment) {
    filtered = filtered.filter((t) => norm(t.deliveryStatus) === fulfillment);
  }

  if (params.unpaid === true) {
    filtered = filtered.filter((t) => norm(t.paymentStatus) !== "paid");
  }

  const riderHint = norm(params.riderName || params.rider);
  if (riderHint) {
    filtered = filtered.filter((t) => includesText(norm(t.riderName), riderHint));
  }

  const refHint = norm(params.referenceId || params.reference);
  if (refHint) {
    filtered = filtered.filter((t) => includesText(norm(t.referenceId), refHint));
  }

  const limit = Math.min(25, Math.max(1, Number(params.limit) || 15));
  const total = filtered.length;
  const rows: RiverAiAgentListRow[] = filtered.slice(0, limit).map((t) => ({
    id: t.id || "",
    label: `${t.referenceId || t.id} — ${t.customerName || "—"}`,
    sublabel: `${t.type} · ${t.deliveryStatus || "—"} · ₱${t.totalAmount ?? 0}`,
    meta: {
      paymentStatus: t.paymentStatus || null,
      scheduledAt: t.scheduledAt ? String(t.scheduledAt) : null,
    },
  }));

  return { rows, total };
}

export async function getTransactionForAgent(
  businessId: string,
  params: Record<string, unknown>,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const transactionId = typeof params.transactionId === "string" ? params.transactionId : undefined;
  const referenceId = typeof params.referenceId === "string" ? params.referenceId : undefined;

  if (transactionId) {
    const tx = await TransactionService.getTransaction(businessId, transactionId);
    if (!tx) return { rows: [], total: 0 };
    return {
      rows: [
        {
          id: tx.id || "",
          label: `${tx.referenceId} — ${tx.customerName}`,
          sublabel: `${tx.type} · ${tx.deliveryStatus}`,
          meta: { totalAmount: tx.totalAmount ?? 0, paymentStatus: tx.paymentStatus || null },
        },
      ],
      total: 1,
    };
  }

  if (referenceId) {
    return listTransactionsForAgent(businessId, { referenceId, limit: 5 });
  }

  return listTransactionsForAgent(businessId, params);
}

export async function listInventoryForAgent(
  businessId: string,
  params: Record<string, unknown>,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const items = await InventoryService.listItems(businessId);
  let filtered = [...items];

  const search = norm(params.search || params.name);
  if (search) {
    filtered = filtered.filter((i) => includesText(norm(i.name), search));
  }

  const category = norm(params.category || params.categoryId);
  if (category) {
    filtered = filtered.filter(
      (i) => includesText(norm(i.categoryId), category) || includesText(norm(i.name), category),
    );
  }

  if (params.lowStock === true) {
    filtered = filtered.filter((i) => {
      const cur = i.stock?.current ?? 0;
      const min = i.stock?.min ?? i.stock?.lowStockThreshold ?? 0;
      return min > 0 && cur <= min;
    });
  }

  const limit = Math.min(25, Math.max(1, Number(params.limit) || 15));
  const total = filtered.length;
  const rows: RiverAiAgentListRow[] = filtered.slice(0, limit).map((i) => ({
    id: i.id || "",
    label: i.name,
    sublabel: `${i.categoryId || "—"} · stock ${i.stock?.current ?? 0}`,
    meta: { unit: i.stock?.unit || null },
  }));

  return { rows, total };
}

export async function listCatalogForAgent(
  businessId: string,
): Promise<{ rows: RiverAiAgentListRow[]; total: number }> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const biz = snap.data() || {};
  const rows: RiverAiAgentListRow[] = [];

  type WaterTypeRow = { id?: string; name?: string; price?: number };
  for (const wt of (biz.waterTypes as WaterTypeRow[]) || []) {
    rows.push({
      id: String(wt.id || wt.name || ""),
      label: `Water: ${wt.name || "—"}`,
      sublabel: `₱${wt.price ?? 0}`,
      meta: { kind: "water" },
    });
  }
  for (const cat of (biz.inventoryCategories as Array<{ id?: string; name?: string }>) || []) {
    rows.push({
      id: String(cat.id || cat.name || ""),
      label: `Inv category: ${cat.name || "—"}`,
      meta: { kind: "inventory_category" },
    });
  }
  for (const cat of (biz.expenseCategories as string[]) || []) {
    rows.push({
      id: cat,
      label: `Expense: ${cat}`,
      meta: { kind: "expense_category" },
    });
  }

  return { rows, total: rows.length };
}
