import { db } from "../../config/firebase-admin";
import { normalizeName } from "../ai/name-fuzzy";
import { CustomerService } from "../customers/customer-service";
import {
  parseCommunityOrderLines,
  formatCommunityOrderLines,
  type CommunityOrderLine,
} from "../meta/community-dispatch-template-parser";
import {
  getLastFulfilledOperationalTransaction,
} from "../transactions/nearby-quiet-customers";
import {
  TransactionService,
  type Transaction,
  type TransactionRefill,
  type TransactionInventoryItem,
  type CollectionItem,
} from "../transactions/transaction-service";

const DEFAULT_WATER_PRICE = 25;

type WaterTypeRow = { water?: string; name?: string; price?: number };

export type NearbyDormantOrderSpec = {
  type?: "delivery" | "collection";
  repeatLast?: boolean;
  deliveryLines?: TransactionRefill[];
  items?: TransactionInventoryItem[];
  collectionItems?: CollectionItem[];
};

function readWaterTypeLabel(row: WaterTypeRow | string): string {
  if (typeof row === "string") return row.trim();
  return String(row.water || row.name || "").trim();
}

async function loadBusinessWaterTypes(businessId: string): Promise<WaterTypeRow[]> {
  const snap = await db.collection("businesses").doc(businessId).get();
  return (snap.data()?.waterTypes ?? []) as WaterTypeRow[];
}

async function resolveWaterPrice(
  businessId: string,
  waterTypeId: string,
  customer: Awaited<ReturnType<typeof CustomerService.getCustomer>>,
): Promise<number> {
  if (customer?.pricing && customer.pricing[waterTypeId] !== undefined) {
    return customer.pricing[waterTypeId];
  }
  const waterTypes = await loadBusinessWaterTypes(businessId);
  for (const wt of waterTypes) {
    const wtId = readWaterTypeLabel(wt);
    if (wtId === waterTypeId && typeof wt === "object" && wt.price != null) {
      return Number(wt.price);
    }
  }
  return DEFAULT_WATER_PRICE;
}

async function resolveWaterTypeId(
  businessId: string,
  preferredWaterType?: string,
): Promise<string> {
  const waterTypes = await loadBusinessWaterTypes(businessId);
  if (!waterTypes.length) return preferredWaterType?.trim() || "Water";

  const preferred = preferredWaterType?.trim();
  if (preferred) {
    const preferredNorm = normalizeName(preferred);
    for (const row of waterTypes) {
      const label = readWaterTypeLabel(row);
      if (normalizeName(label) === preferredNorm) return label;
    }
    const partial = waterTypes.find((row) => {
      const label = readWaterTypeLabel(row);
      const labelNorm = normalizeName(label);
      return labelNorm.includes(preferredNorm) || preferredNorm.includes(labelNorm);
    });
    if (partial) return readWaterTypeLabel(partial);
  }

  return readWaterTypeLabel(waterTypes[0]) || "Water";
}

export function parseRiderMessengerOrderLineTail(tail: string): CommunityOrderLine[] {
  const normalized = tail
    .replace(/\s*\+\s*/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  if (!normalized) return [];
  return parseCommunityOrderLines(normalized);
}

export async function communityLinesToDeliveryRefills(params: {
  businessId: string;
  customerId: string;
  lines: CommunityOrderLine[];
}): Promise<TransactionRefill[]> {
  const customer = await CustomerService.getCustomer(params.businessId, params.customerId);
  const refills: TransactionRefill[] = [];
  for (const line of params.lines) {
    const waterLabel = await resolveWaterTypeId(params.businessId, line.waterType);
    const label = `${waterLabel} (${line.container})`;
    const unitPrice = await resolveWaterPrice(params.businessId, label, customer);
    refills.push({
      waterTypeId: label,
      name: label,
      quantity: line.qty,
      unitPrice,
      subtotal: unitPrice * line.qty,
    });
  }
  return refills;
}

export function summarizeDeliveryLines(tx: Transaction | null): string[] {
  if (!tx) return [];
  const lines: string[] = [];
  for (const r of tx.waterRefills ?? []) {
    const qty = Number(r.quantity) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${qty} ${r.name || r.waterTypeId}`);
  }
  for (const i of tx.items ?? []) {
    const qty = Number(i.quantity) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${qty} ${i.name || i.inventoryId} (container)`);
  }
  return lines;
}

export function summarizeCollectionLines(tx: Transaction | null): string[] {
  if (!tx) return [];
  const lines: string[] = [];
  for (const c of tx.collectionItems ?? []) {
    const qty = Number(c.qtyExpected) || 0;
    if (qty <= 0) continue;
    lines.push(`• ${qty} ${c.name || c.inventoryId}`);
  }
  return lines;
}

function cloneCollectionItems(lastTx: Transaction): CollectionItem[] {
  return (lastTx.collectionItems ?? [])
    .filter((item) => (Number(item.qtyExpected) || 0) > 0)
    .map((item) => ({
      ...item,
      qtyCollected: 0,
      qtyOk: 0,
      qtyDamaged: 0,
      qtyMissing: 0,
      deficitQty: 0,
      status: "pending" as const,
    }));
}

function cloneDeliveryFromLastTx(lastTx: Transaction): {
  waterRefills: TransactionRefill[];
  items: TransactionInventoryItem[];
} {
  return {
    waterRefills: (lastTx.waterRefills ?? []).filter(
      (line) => (Number(line.quantity) || 0) > 0,
    ),
    items: (lastTx.items ?? []).filter(
      (line) => (Number(line.quantity) || 0) > 0,
    ),
  };
}

function scaleSingleRefillLine(
  refills: TransactionRefill[],
  qty: number,
): TransactionRefill[] {
  if (refills.length !== 1) return refills;
  const line = refills[0];
  const unitPrice = Number(line.unitPrice) || 0;
  return [{
    ...line,
    quantity: qty,
    subtotal: unitPrice * qty,
  }];
}

export function formatOrderCatalogHint(): string {
  return "Format: qty container watertype (hal. 3 slim alkaline, 2 round purified)";
}

export function formatOrderPreviewMessage(params: {
  customerName: string;
  orderType: "delivery" | "collection";
  daysSinceLastOrder?: number;
  lineSummaries: string[];
  explicitLines?: CommunityOrderLine[];
  needsConfirm: boolean;
}): string {
  const typeLabel = params.orderType === "collection" ? "Collection" : "Delivery";
  const quietLine =
    params.daysSinceLastOrder != null ?
      ` · quiet ${params.daysSinceLastOrder}d` :
      "";
  const lines: string[] = [
    `📋 Order preview · ${params.customerName}`,
    `${typeLabel}${quietLine}`,
    "",
  ];

  if (params.explicitLines?.length) {
    lines.push("Order:");
    lines.push(`• ${formatCommunityOrderLines(params.explicitLines)}`);
  } else if (params.lineSummaries.length) {
    lines.push("Repeat last order:");
    lines.push(...params.lineSummaries.slice(0, 8));
  } else {
    lines.push("Walang nakitang last order lines.");
    lines.push(formatOrderCatalogHint());
  }

  lines.push("");
  if (params.needsConfirm) {
    lines.push("I-send YES para i-confirm.");
    lines.push(formatOrderCatalogHint());
    lines.push("O specify: ORDER # DEL 3 slim alkaline, 2 round purified");
  } else {
    lines.push("Creating order…");
  }
  return lines.join("\n").slice(0, 1900);
}

export async function buildNearbyDormantOrderSpec(params: {
  businessId: string;
  customerId: string;
  orderType: "delivery" | "collection";
  orderLines?: CommunityOrderLine[];
  orderQty?: number;
  repeatLast?: boolean;
}): Promise<{
  orderSpec: NearbyDormantOrderSpec;
  summaryLines: string[];
  needsConfirm: boolean;
  explicitLines?: CommunityOrderLine[];
}> {
  const transactions = await TransactionService.getTransactionsByBusiness(
    params.businessId,
    { limit: 500, orderBy: "scheduledAt" },
  );
  const lastTx = getLastFulfilledOperationalTransaction(
    params.customerId,
    transactions,
  );

  if (params.orderType === "collection") {
    if (params.orderLines?.length) {
      throw new Error(
        "Collection ORDER: gamitin ORDER # COLLECTION o i-repeat ang last collection (YES sa preview).",
      );
    }
    const collectionItems =
      lastTx?.type === "collection" ?
        cloneCollectionItems(lastTx) :
        [];
    if (!collectionItems.length) {
      return {
        orderSpec: { type: "collection", repeatLast: true, collectionItems: [] },
        summaryLines: [],
        needsConfirm: true,
      };
    }
    return {
      orderSpec: { type: "collection", collectionItems },
      summaryLines: summarizeCollectionLines(lastTx),
      needsConfirm: params.repeatLast !== false && params.orderQty == null,
    };
  }

  if (params.orderLines?.length) {
    const deliveryLines = await communityLinesToDeliveryRefills({
      businessId: params.businessId,
      customerId: params.customerId,
      lines: params.orderLines,
    });
    return {
      orderSpec: { type: "delivery", deliveryLines },
      summaryLines: deliveryLines.map(
        (line) => `• ${line.quantity} ${line.name || line.waterTypeId}`,
      ),
      needsConfirm: false,
      explicitLines: params.orderLines,
    };
  }

  if (lastTx?.type === "delivery") {
    const cloned = cloneDeliveryFromLastTx(lastTx);
    const refillCount = cloned.waterRefills.length;
    const hasItems = cloned.items.length > 0;

    if (params.orderQty != null) {
      if (refillCount === 1 && !hasItems) {
        const scaled = scaleSingleRefillLine(cloned.waterRefills, params.orderQty);
        return {
          orderSpec: {
            type: "delivery",
            deliveryLines: scaled,
            items: cloned.items,
          },
          summaryLines: scaled.map(
            (line) => `• ${line.quantity} ${line.name || line.waterTypeId}`,
          ),
          needsConfirm: true,
          explicitLines: undefined,
        };
      }
      return {
        orderSpec: { type: "delivery", repeatLast: true },
        summaryLines: summarizeDeliveryLines(lastTx),
        needsConfirm: true,
      };
    }

    if (cloned.waterRefills.length || cloned.items.length) {
      return {
        orderSpec: {
          type: "delivery",
          deliveryLines: cloned.waterRefills,
          items: cloned.items,
        },
        summaryLines: summarizeDeliveryLines(lastTx),
        needsConfirm: true,
      };
    }
  }

  const customer = await CustomerService.getCustomer(params.businessId, params.customerId);
  const preferred =
    (customer?.preferredWaterType && String(customer.preferredWaterType).trim()) ||
    (await resolveWaterTypeId(params.businessId, undefined));
  const qty = Math.max(1, params.orderQty ?? 1);
  const unitPrice = await resolveWaterPrice(params.businessId, preferred, customer);
  const fallbackLine: TransactionRefill = {
    waterTypeId: preferred,
    name: preferred,
    quantity: qty,
    unitPrice,
    subtotal: unitPrice * qty,
  };
  return {
    orderSpec: { type: "delivery", deliveryLines: [fallbackLine] },
    summaryLines: [`• ${qty} ${preferred}`],
    needsConfirm: true,
  };
}

export function formatOrderCreatedLinesMessage(params: {
  customerName: string;
  referenceId: string;
  type: "delivery" | "collection";
  summaryLines: string[];
  daysSinceLastOrder?: number;
}): string {
  const typeLabel = params.type === "collection" ? "Collection" : "Delivery";
  const quietLine =
    params.daysSinceLastOrder != null ?
      ` (quiet ${params.daysSinceLastOrder}d)` :
      "";
  const lines: string[] = [
    `✅ Na-schedule ang ${params.customerName}${quietLine}`,
    `${params.referenceId} · ${typeLabel}`,
  ];
  if (params.summaryLines.length) {
    lines.push("");
    lines.push(...params.summaryLines.slice(0, 8));
  }
  lines.push("");
  lines.push("I-send ang JOBS para i-refresh · DETAILS # para full info");
  return lines.join("\n").slice(0, 1900);
}
