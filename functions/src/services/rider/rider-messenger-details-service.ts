import { CustomerService } from "../customers/customer-service";
import { TransactionService, type Transaction } from "../transactions/transaction-service";
import { getLastFulfilledOperationalTransaction } from "../transactions/nearby-quiet-customers";
import {
  summarizeCollectionLines,
  summarizeDeliveryLines,
} from "./rider-messenger-order-lines-service";
import type { RiderMessengerJobRow, RiderMessengerNearbyRow } from "./rider-messenger-types";

function formatMoney(amount: number | undefined): string {
  const n = Number(amount) || 0;
  if (n <= 0) return "₱0";
  return `₱${n.toLocaleString("en-PH")}`;
}

function formatRefillLines(tx: Transaction): string[] {
  const lines: string[] = [];
  for (const r of tx.waterRefills ?? []) {
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${r.name || r.waterTypeId || "Water"} × ${qty}`);
  }
  for (const i of tx.items ?? []) {
    const qty = Number(i.quantity) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${i.name || "Item"} × ${qty}`);
  }
  return lines;
}

function formatCollectionLines(tx: Transaction): string[] {
  const lines: string[] = [];
  for (const c of tx.collectionItems ?? []) {
    const qty = Number(c.qtyExpected) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${c.name || "Container"} × ${qty}`);
  }
  return lines;
}

export function formatTransactionDetailsMessage(params: {
  tx: Transaction;
  customerPhone?: string;
  customerAddress?: string;
}): string {
  const tx = params.tx;
  const typeLabel = tx.type === "collection" ? "Collection" : "Delivery";
  const lines: string[] = [
    `📄 ${tx.referenceId || tx.id || "Order"}`,
    `${tx.customerName || "Customer"} · ${typeLabel}`,
    `Status: ${tx.deliveryStatus || "—"}`,
  ];

  if (params.customerPhone?.trim()) {
    lines.push(`📞 ${params.customerPhone.trim()}`);
  }
  if (params.customerAddress?.trim()) {
    lines.push(`📍 ${params.customerAddress.trim().slice(0, 160)}`);
  }

  const itemLines =
    tx.type === "collection" ? formatCollectionLines(tx) : formatRefillLines(tx);
  if (itemLines.length) {
    lines.push("");
    lines.push(tx.type === "collection" ? "Collect:" : "Deliver:");
    lines.push(...itemLines.slice(0, 8));
  }

  const total = Number(tx.totalAmount) || 0;
  const balance = Number(tx.balanceDue) || 0;
  if (total > 0 || balance > 0 || tx.paymentStatus) {
    lines.push("");
    lines.push(
      `Total ${formatMoney(total)} · Balance ${formatMoney(balance)} · ${tx.paymentStatus || "—"}`,
    );
  }

  if (tx.notes?.trim()) {
    lines.push("");
    lines.push(`Notes: ${tx.notes.trim().slice(0, 200)}`);
  }

  if (tx.riderName?.trim()) {
    lines.push(`Rider: ${tx.riderName.trim()}`);
  }

  lines.push("");
  lines.push("START # · DONE # · REPORT # (collection)");
  return lines.join("\n").slice(0, 1900);
}

export function formatQuietCustomerDetailsMessage(params: {
  nearby: RiderMessengerNearbyRow;
  phone?: string;
  address?: string;
  lastOrderLines?: string[];
}): string {
  const typeLabel = params.nearby.type === "collection" ? "Collection" : "Delivery";
  const lines: string[] = [
    `📄 ${params.nearby.customerName} · Quiet suki`,
    `${typeLabel} · ${params.nearby.daysSinceLastOrder ?? 7}d since last order`,
    `Malapit: ${params.nearby.distanceKm < 1 ?
      `${Math.round(params.nearby.distanceKm * 1000)}m` :
      `${params.nearby.distanceKm.toFixed(1)}km`}`,
  ];

  if (params.phone?.trim()) lines.push(`📞 ${params.phone.trim()}`);
  if (params.address?.trim()) {
    lines.push(`📍 ${params.address.trim().slice(0, 160)}`);
  }

  if (params.lastOrderLines?.length) {
    lines.push("");
    lines.push("Last order:");
    lines.push(...params.lastOrderLines.slice(0, 8));
  }

  lines.push("");
  lines.push("Walang open order — mag-schedule:");
  lines.push("ORDER # — repeat last order (YES to confirm)");
  lines.push("ORDER # DEL 3 slim alkaline, 2 round purified");
  lines.push("ORDER # COLLECTION — repeat collection");
  lines.push("CLAIM # — same as ORDER (auto repeat)");
  return lines.join("\n").slice(0, 1900);
}

export async function buildDetailsMessageForJob(params: {
  businessId: string;
  job: RiderMessengerJobRow;
}): Promise<string | null> {
  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.job.transactionId,
  );
  if (!tx) return null;

  let phone = params.job.phone;
  let address: string | undefined;
  if (tx.customerId) {
    const customer = await CustomerService.getCustomer(
      params.businessId,
      tx.customerId,
    );
    if (customer) {
      phone = phone || customer.phone?.trim();
      address = customer.address?.trim();
    }
  }

  return formatTransactionDetailsMessage({
    tx,
    customerPhone: phone,
    customerAddress: address,
  });
}

export async function buildDetailsMessageForNearby(params: {
  businessId: string;
  nearby: RiderMessengerNearbyRow;
}): Promise<string | null> {
  if (params.nearby.source === "dormant") {
    const customer = await CustomerService.getCustomer(
      params.businessId,
      params.nearby.customerId,
    );
    const transactions = await TransactionService.getTransactionsByBusiness(
      params.businessId,
      { limit: 500, orderBy: "scheduledAt" },
    );
    const lastTx = getLastFulfilledOperationalTransaction(
      params.nearby.customerId,
      transactions,
    );
    const lastOrderLines =
      lastTx?.type === "collection" ?
        summarizeCollectionLines(lastTx) :
        summarizeDeliveryLines(lastTx);
    return formatQuietCustomerDetailsMessage({
      nearby: params.nearby,
      phone: customer?.phone?.trim(),
      address: customer?.address?.trim(),
      lastOrderLines,
    });
  }

  if (!params.nearby.transactionId) return null;
  const tx = await TransactionService.getTransaction(
    params.businessId,
    params.nearby.transactionId,
  );
  if (!tx) return null;

  let phone: string | undefined;
  let address: string | undefined;
  if (tx.customerId) {
    const customer = await CustomerService.getCustomer(
      params.businessId,
      tx.customerId,
    );
    phone = customer?.phone?.trim();
    address = customer?.address?.trim();
  }

  return formatTransactionDetailsMessage({
    tx,
    customerPhone: phone,
    customerAddress: address,
  });
}
