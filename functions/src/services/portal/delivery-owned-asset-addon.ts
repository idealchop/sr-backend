import { InventoryService } from "../inventory/inventory-service";
import {
  inferInventoryItemRole,
  isContainerShapeRole,
} from "../inventory/container-kit";

function nameIncludesSlim(name: string): boolean {
  return name.toLowerCase().includes("slim");
}

function nameIncludesRound(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("round") && !lower.includes("slim");
}

function isOwnedShapeCatalogItem(item: {
  name: string;
  inventoryRole?: unknown;
}): boolean {
  const role = inferInventoryItemRole(item.name, item.inventoryRole);
  if (isContainerShapeRole(role)) return true;
  return nameIncludesRound(item.name) || nameIncludesSlim(item.name);
}

export type PortalInventoryLine = {
  inventoryId: string;
  qty?: number;
  unitPrice?: number;
};

/**
 * True when delivery add-ons are enabled and the portal order includes priced Round/Slim lines.
 * Those purchases are customer-owned assets — WRS custody does not apply.
 */
export async function submissionHasDeliveryOwnedAssetAddons(
  businessId: string,
  inventoryItems: PortalInventoryLine[] | null | undefined,
  deliveryInventorySalesEnabled: boolean,
): Promise<boolean> {
  if (deliveryInventorySalesEnabled !== true) return false;

  const lines = Array.isArray(inventoryItems) ? inventoryItems : [];
  for (const line of lines) {
    const invId = String(line.inventoryId || "").trim();
    if (!invId) continue;
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    const item = await InventoryService.getItem(businessId, invId);
    if (item && isOwnedShapeCatalogItem(item)) return true;
  }

  return false;
}
