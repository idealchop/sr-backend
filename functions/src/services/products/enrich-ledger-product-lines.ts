import { InventoryService } from "../inventory/inventory-service";
import type {
  TransactionInventoryItem,
  TransactionRefill,
} from "../transactions/transaction-types";
import {
  catalogKeyForProduct,
  findProductForRefillLine,
  isVirtualProductId,
  mergeBomInventoryLines,
  waterTypeIdForProduct,
} from "./product-catalog";
import { ProductService } from "./product-service";

export async function enrichLedgerProductLines(
  businessId: string,
  waterRefills: TransactionRefill[],
  items: TransactionInventoryItem[],
): Promise<{
  waterRefills: TransactionRefill[];
  items: TransactionInventoryItem[];
}> {
  if (!waterRefills.length) {
    return { waterRefills, items };
  }

  const products = await ProductService.ensureSeeded(businessId);
  if (!products.length) {
    return { waterRefills, items };
  }

  const nextRefills = waterRefills.map((line) => {
    const product = findProductForRefillLine(products, {
      productId: line.productId,
      type: line.waterTypeId,
      name: line.name,
      waterTypeId: line.waterTypeId,
    });
    if (!product || isVirtualProductId(product.id)) return line;
    const catalogKey = catalogKeyForProduct(product);
    return {
      ...line,
      productId: product.id,
      waterTypeId: waterTypeIdForProduct(product),
      name: line.name || `${catalogKey} Refill`,
    };
  });

  const itemNames: Record<string, string> = {};
  for (const item of items) {
    if (item.inventoryId && item.name) itemNames[item.inventoryId] = item.name;
  }
  for (const product of products) {
    for (const component of product.components) {
      if (itemNames[component.inventoryItemId]) continue;
      const stock = await InventoryService.getItem(
        businessId,
        component.inventoryItemId,
      );
      if (stock?.name) itemNames[component.inventoryItemId] = stock.name;
    }
  }

  const nextItems = mergeBomInventoryLines(
    items.map((item) => ({
      inventoryId: item.inventoryId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    products,
    nextRefills.map((line) => ({
      productId: line.productId,
      type: line.waterTypeId,
      name: line.name,
      waterTypeId: line.waterTypeId,
      quantity: line.quantity,
    })),
    itemNames,
  );

  return {
    waterRefills: nextRefills,
    items: nextItems.map((item) => ({
      inventoryId: item.inventoryId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
  };
}
