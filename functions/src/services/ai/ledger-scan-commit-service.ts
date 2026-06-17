import { logger } from "../observability/logging/logger";
import {
  CustomerService,
  type Customer,
} from "../customers/customer-service";
import { InventoryService } from "../inventory/inventory-service";
import { TransactionService } from "../transactions/transaction-service";
import {
  customerLookupKey,
  isWalkInCustomerName,
  matchCustomersToLedgerRows,
  normalizePhoneKey,
  rowNeedsCustomerMatch,
} from "./ledger-scan-customer-match";
import { resolveCustomerLocationWithGeocode } from "../customers/customer-address-geocode";
import { normalizeLedgerType } from "./ledger-scan-normalize";
import type {
  ExtractedLedgerInventoryLine,
  ExtractedLedgerRow,
} from "./ledger-scan-types";

function mapPaymentMethod(
  m?: string,
): "cash" | "digital_wallet" | "bank_transfer" | "other" {
  if (m === "Online Payment") return "digital_wallet";
  if (m === "Cash") return "cash";
  return "cash";
}

function resolvePayment(
  row: ExtractedLedgerRow,
  totalAmount: number,
): { amountPaid: number; paymentStatus: "paid" | "partial" | "unpaid" } {
  if (row.paymentStatus === "paid") {
    return { amountPaid: totalAmount, paymentStatus: "paid" };
  }
  if (row.paymentStatus === "partial") {
    const half = Math.max(0, Math.round(totalAmount / 2));
    return { amountPaid: half, paymentStatus: "partial" };
  }
  if (row.paymentStatus === "unpaid" || row.paymentMethod === "Not Paid") {
    return { amountPaid: 0, paymentStatus: "unpaid" };
  }
  const delivered = row.deliveryStatus !== "pending";
  if (delivered && totalAmount > 0) {
    return { amountPaid: totalAmount, paymentStatus: "paid" };
  }
  return {
    amountPaid: 0,
    paymentStatus: totalAmount > 0 ? "unpaid" : "paid",
  };
}

function resolveDeliveryStatus(row: ExtractedLedgerRow): "pending" | "delivered" {
  if (row.deliveryStatus === "pending" || row.status === "Order Placed") {
    return "pending";
  }
  return "delivered";
}

function findDefaultContainer(
  items: { id?: string; name: string; categoryId?: string }[],
): { id: string; name: string } | null {
  const lower = (s: string) => s.toLowerCase();
  const containerLike = items.find((i) => {
    if (!i.id) return false;
    const cat = lower(i.categoryId || "");
    const name = lower(i.name);
    return (
      cat.includes("container") ||
      name.includes("container") ||
      name.includes("gallon") ||
      name.includes("jug")
    );
  });
  if (containerLike?.id) {
    return { id: containerLike.id, name: containerLike.name };
  }
  const first = items.find((i) => i.id);
  return first?.id ? { id: first.id, name: first.name } : null;
}

export class LedgerScanCommitService {
  static async commitExtracted(params: {
    businessId: string;
    userId: string;
    rows: ExtractedLedgerRow[];
    inventoryLines?: ExtractedLedgerInventoryLine[];
    defaultWaterTypeId: string;
    defaultWaterName: string;
    defaultUnitPrice: number;
  }): Promise<{ created: number; errors: string[] }> {
    const {
      businessId,
      userId,
      rows,
      inventoryLines = [],
      defaultWaterTypeId,
      defaultWaterName,
      defaultUnitPrice,
    } = params;
    let created = 0;
    const errors: string[] = [];

    const [existingCustomers, inventoryItems] = await Promise.all([
      CustomerService.getCustomersByBusiness(businessId),
      InventoryService.listItems(businessId),
    ]);
    const defaultContainer = findDefaultContainer(inventoryItems);
    const sessionCustomerIds = new Map<string, string>();

    const normalizedRows = matchCustomersToLedgerRows(
      rows.map((row) => ({
        ...row,
        transactionType: normalizeLedgerType(row.transactionType, row),
      })),
      existingCustomers.map((c) => ({
        id: c.id || "",
        name: c.name,
        phone: c.phone,
        address: c.address,
      })),
    );

    for (const row of normalizedRows) {
      try {
        const txType = normalizeLedgerType(row.transactionType, row);

        if (txType === "expense") {
          const total = Number(row.amount) || 0;
          if (total <= 0) continue;
          const pay = resolvePayment(row, total);
          await TransactionService.addTransaction(
            businessId,
            {
              type: "expense",
              customerName: row.customerName || "Expenses",
              totalAmount: total,
              amountPaid: pay.amountPaid,
              paymentStatus: pay.paymentStatus,
              paymentMethod: mapPaymentMethod(row.paymentMethod),
              expenseCategory:
                (row.notes && row.notes.length < 80 ? row.notes : null) ||
                "General",
              notes: row.notes,
              scheduledAt: row.date,
              deliveryStatus: "delivered",
            },
            userId,
          );
          created++;
          continue;
        }

        if (txType === "collection") {
          if (!defaultContainer) {
            errors.push(
              "No inventory container item found for collection row — add a container SKU first.",
            );
            continue;
          }
          const customerId = await LedgerScanCommitService.resolveCustomerId({
            businessId,
            row,
            existingCustomers,
            sessionCustomerIds,
          });
          const qty = Math.max(1, Math.round(Number(row.bottleQuantity) || 1));
          const delivered = resolveDeliveryStatus(row) === "delivered";
          await TransactionService.addTransaction(
            businessId,
            {
              type: "collection",
              customerId,
              customerName: row.customerName,
              collectionItems: [
                {
                  inventoryId: defaultContainer.id,
                  name: defaultContainer.name,
                  qtyExpected: qty,
                  qtyCollected: delivered ? qty : 0,
                  qtyOk: delivered ? qty : 0,
                  qtyDamaged: 0,
                  qtyMissing: delivered ? 0 : qty,
                  deficitQty: delivered ? 0 : qty,
                  status: delivered ? "ok" : "pending",
                },
              ],
              totalAmount: 0,
              amountPaid: 0,
              paymentStatus: "paid",
              paymentMethod: "other",
              notes: row.notes,
              scheduledAt: row.date,
              deliveryStatus: resolveDeliveryStatus(row),
            },
            userId,
          );
          created++;
          continue;
        }

        const customerId = await LedgerScanCommitService.resolveCustomerId({
          businessId,
          row,
          existingCustomers,
          sessionCustomerIds,
        });

        const qty = Math.max(0, Math.round(Number(row.bottleQuantity) || 0));
        const amount =
          row.amount && Number(row.amount) > 0 ?
            Number(row.amount) :
            qty * defaultUnitPrice;
        if (qty <= 0 && amount <= 0) continue;

        const lineQty = qty > 0 ? qty : 1;
        const pay = resolvePayment(row, amount);
        const deliveryStatus = resolveDeliveryStatus(row);
        const type = txType === "walkin" ? "walkin" : "delivery";

        const waterRefills = [
          {
            waterTypeId: defaultWaterTypeId,
            name: defaultWaterName,
            quantity: lineQty,
            unitPrice: lineQty > 0 ? amount / lineQty : defaultUnitPrice,
            subtotal: amount,
          },
        ];

        await TransactionService.addTransaction(
          businessId,
          {
            type,
            customerId,
            customerName: row.customerName || "Walk-in Customer",
            waterRefills,
            totalAmount: amount,
            amountPaid: pay.amountPaid,
            paymentStatus: pay.paymentStatus,
            paymentMethod: mapPaymentMethod(row.paymentMethod),
            notes: row.notes,
            scheduledAt: row.date,
            deliveryStatus,
          },
          userId,
        );
        created++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("ledger_scan_commit_row_failed", { msg, row });
        errors.push(msg);
      }
    }

    for (const line of inventoryLines) {
      const id = String(line.inventoryItemId || "");
      const count = Number(line.count);
      if (!id || !Number.isFinite(count) || count <= 0) {
        if (line.isNew) {
          errors.push(`Unmatched inventory SKU: ${line.itemName}`);
        }
        continue;
      }
      try {
        await InventoryService.adjustStock(businessId, id, count, {
          userId,
          reason: "AI_LEDGER_SCAN_STOCK",
        });
        created++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("ledger_scan_commit_inventory_failed", { msg, line });
        errors.push(msg);
      }
    }

    return { created, errors };
  }

  private static async resolveCustomerId(params: {
    businessId: string;
    row: ExtractedLedgerRow;
    existingCustomers: Customer[];
    sessionCustomerIds: Map<string, string>;
  }): Promise<string | undefined> {
    const { businessId, row, existingCustomers, sessionCustomerIds } = params;
    if (!rowNeedsCustomerMatch(row) || isWalkInCustomerName(row.customerName)) {
      return undefined;
    }

    const batchKey = customerLookupKey(row.customerName, row.customerPhone);
    const cached = sessionCustomerIds.get(batchKey);
    if (cached) return cached;
    if (row.customerId) {
      sessionCustomerIds.set(batchKey, row.customerId);
      return row.customerId;
    }

    const phoneKey = row.customerPhone ?
      normalizePhoneKey(row.customerPhone) :
      "";
    if (phoneKey.length >= 7) {
      const byPhone = existingCustomers.find(
        (c) => normalizePhoneKey(c.phone || "") === phoneKey && c.id,
      );
      if (byPhone?.id) {
        sessionCustomerIds.set(batchKey, byPhone.id);
        return byPhone.id;
      }
    }

    const rematched = matchCustomersToLedgerRows(
      [row],
      existingCustomers.map((c) => ({
        id: c.id || "",
        name: c.name,
        phone: c.phone,
        address: c.address,
      })),
    )[0];
    if (rematched.customerId) {
      sessionCustomerIds.set(batchKey, rematched.customerId);
      return rematched.customerId;
    }

    if (rematched.isNewCustomer) {
      const location = await resolveCustomerLocationWithGeocode({
        address: row.address || "",
      });
      const created = await CustomerService.addCustomer(businessId, {
        name: row.customerName,
        phone: row.customerPhone || "",
        address: location.address,
        ...(location.latitude != null && location.longitude != null ?
          { latitude: location.latitude, longitude: location.longitude } :
          {}),
        type: "residential",
        isDeliveryEnabled: true,
      });
      if (created.id) {
        sessionCustomerIds.set(batchKey, created.id);
        existingCustomers.push(created);
        return created.id;
      }
    }

    return undefined;
  }
}
