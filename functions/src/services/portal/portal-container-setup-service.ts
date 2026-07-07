import { db } from "../../config/firebase-admin";
import { CustomerService } from "../customers/customer-service";
import type { CustomerContainerPolicy } from "../customers/container-policy";
import {
  isContainerInventoryName,
  type ContainerCatalogRow,
} from "../inventory/container-catalog-utils";

export type PortalContainerSetupPayload = {
  containerPolicy: "byog" | "wrs_rotation";
  ownContainers?: Array<{
    inventoryId: string;
    itemName?: string;
    quantity: number;
  }>;
};

async function loadContainerCatalog(
  businessId: string,
): Promise<ContainerCatalogRow[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("inventory_items")
    .get();
  return snap.docs
    .map((doc) => ({
      id: doc.id,
      name: String(doc.data().name || ""),
    }))
    .filter((row) => isContainerInventoryName(row.name));
}

export async function applyPortalContainerSetup(
  businessId: string,
  customerId: string,
  payload: PortalContainerSetupPayload,
): Promise<void> {
  const policy = payload.containerPolicy;
  if (policy !== "byog" && policy !== "wrs_rotation") {
    throw new Error("INVALID_CONTAINER_POLICY");
  }

  const updates: {
    containerPolicy: CustomerContainerPolicy;
    possession?: Record<string, { itemName: string; quantity: number }>;
  } = {
    containerPolicy: policy,
  };

  if (policy === "byog") {
    const rows = Array.isArray(payload.ownContainers) ?
      payload.ownContainers :
      [];
    const normalized = rows
      .map((row) => ({
        inventoryId: String(row.inventoryId || "").trim(),
        itemName: String(row.itemName || "").trim(),
        quantity: Number(row.quantity) || 0,
      }))
      .filter((row) => row.inventoryId && row.quantity > 0);

    if (normalized.length === 0) {
      throw new Error("BYOG_CONTAINERS_REQUIRED");
    }

    const catalog = await loadContainerCatalog(businessId);
    const catalogById = new Map(catalog.map((row) => [row.id, row.name]));
    const containerIds = new Set(catalog.map((row) => row.id));

    for (const row of normalized) {
      if (!containerIds.has(row.inventoryId)) {
        throw new Error("INVALID_CONTAINER_ITEM");
      }
    }

    const customer = await CustomerService.getCustomer(businessId, customerId);
    const existing = customer?.possession ?? {};
    const nextPossession: Record<string, { itemName: string; quantity: number }> =
      { ...existing };

    for (const id of containerIds) {
      delete nextPossession[id];
    }

    for (const row of normalized) {
      const itemName = row.itemName || catalogById.get(row.inventoryId) || "Container";
      nextPossession[row.inventoryId] = {
        itemName,
        quantity: row.quantity,
      };
    }

    updates.possession = nextPossession;
  }

  await CustomerService.updateCustomer(businessId, customerId, updates as any);
}
