import { CustomerService } from "../customers/customer-service";
import { InventoryService, type InventoryItem } from "../inventory/inventory-service";
import {
  inferInventoryItemRole,
  isContainerShapeRole,
} from "../inventory/container-kit";

type CatalogRow = { id: string; name: string; inventoryRole?: unknown };

function inventoryCatalogRows(inventory: InventoryItem[]): CatalogRow[] {
  return inventory.flatMap((item) =>
    item.id ? [{ id: item.id, name: item.name, inventoryRole: item.inventoryRole }] : [],
  );
}

export type RiderContainerDueDiligence = {
  arrivalProducedQty: number;
  resolvedPath: "owned" | "wrs_rotation";
  recordedAt: string;
  crmOwnedShapeQtyAtOrder?: number;
  ownedShapePossessionTarget?: number;
};

function nameIncludesSlim(name: string): boolean {
  return name.toLowerCase().includes("slim");
}

function nameIncludesRound(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("round") && !lower.includes("slim");
}

function isOwnedShapeCatalogItem(item: CatalogRow): boolean {
  const role = inferInventoryItemRole(item.name, item.inventoryRole);
  if (isContainerShapeRole(role)) return true;
  return nameIncludesRound(item.name) || nameIncludesSlim(item.name);
}

function listOwnedShapeIds(inventory: CatalogRow[]): string[] {
  return inventory.filter(isOwnedShapeCatalogItem).map((item) => item.id);
}

function resolveDefaultShapeId(inventory: CatalogRow[]): string | undefined {
  const round = inventory.find(
    (item) => inferInventoryItemRole(item.name, item.inventoryRole) === "container_round",
  );
  if (round?.id) return round.id;
  const slim = inventory.find(
    (item) => inferInventoryItemRole(item.name, item.inventoryRole) === "container_slim",
  );
  if (slim?.id) return slim.id;
  return inventory.find(isOwnedShapeCatalogItem)?.id;
}

/**
 * Sets owned Round/Slim possession to the rider-verified target (due diligence owned path).
 */
export async function applyOwnedShapePossessionTarget(
  businessId: string,
  customerId: string,
  targetQty: number,
): Promise<void> {
  const safeTarget = Math.max(0, Math.floor(targetQty));
  const inventory = inventoryCatalogRows(await InventoryService.listItems(businessId));
  const shapeIds = new Set(listOwnedShapeIds(inventory));
  if (shapeIds.size === 0 || safeTarget <= 0) return;

  const customer = await CustomerService.getCustomer(businessId, customerId);
  if (!customer) return;

  const possession: Record<string, { itemName: string; quantity: number }> = {
    ...(customer.possession ?? {}),
  };

  for (const id of shapeIds) {
    delete possession[id];
  }

  const primaryId = resolveDefaultShapeId(inventory);
  if (!primaryId) return;

  const catalogItem = inventory.find((item) => item.id === primaryId);
  possession[primaryId] = {
    itemName: catalogItem?.name || "Container",
    quantity: safeTarget,
  };

  await CustomerService.updateCustomer(businessId, customerId, { possession });
}

export function isRiderContainerDueDiligence(
  value: unknown,
): value is RiderContainerDueDiligence {
  if (!value || typeof value !== "object") return false;
  const row = value as RiderContainerDueDiligence;
  return (
    typeof row.arrivalProducedQty === "number" &&
    (row.resolvedPath === "owned" || row.resolvedPath === "wrs_rotation") &&
    typeof row.recordedAt === "string"
  );
}

/** True when diligence forces WRS shell possession sync (e.g. BYOG overflow at arrival). */
export function dueDiligenceRequiresWrPossessionSync(
  diligence: RiderContainerDueDiligence | undefined,
): boolean {
  return diligence?.resolvedPath === "wrs_rotation";
}

export function dueDiligenceOwnedPossessionTarget(
  diligence: RiderContainerDueDiligence | undefined,
): number | null {
  if (diligence?.resolvedPath !== "owned") return null;
  const target = diligence.ownedShapePossessionTarget;
  if (typeof target === "number" && Number.isFinite(target)) return Math.max(0, target);
  return Math.max(0, diligence.arrivalProducedQty);
}
