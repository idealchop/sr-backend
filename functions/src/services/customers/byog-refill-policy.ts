import { db } from "../../config/firebase-admin";
import {
  isContainerInventoryName,
  sumOwnedContainerQuantity,
  sumRefillQuantity,
  type ContainerCatalogRow,
} from "../inventory/container-catalog-utils";
import { CustomerService } from "./customer-service";
import {
  getBusinessContainerDefaultPolicy,
  isByogContainerPolicy,
  resolveContainerPolicy,
  type ContainerDefaultPolicy,
} from "./container-policy";

export type ByogRefillReconcileResult = {
  upgraded: boolean;
  effectivePolicy: ContainerDefaultPolicy;
  refillQty: number;
  ownedQty: number;
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

/**
 * BYOG customers cannot mix owned shells with WRS containers on one order.
 * When refill qty exceeds declared owned containers, switch to WRS rotation.
 */
export async function reconcileByogRefillPolicyIfNeeded(
  businessId: string,
  customerId: string,
  refillItems?: Array<{ qty?: number }> | null,
): Promise<ByogRefillReconcileResult> {
  const refillQty = sumRefillQuantity(refillItems);
  const customer = await CustomerService.getCustomer(businessId, customerId);
  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const businessDefault = getBusinessContainerDefaultPolicy(
    bizSnap.data() as Record<string, unknown> | undefined,
  );
  const effectivePolicy = resolveContainerPolicy(
    customer?.containerPolicy,
    businessDefault,
  );

  if (!customer || refillQty <= 0 || !isByogContainerPolicy(effectivePolicy)) {
    return {
      upgraded: false,
      effectivePolicy,
      refillQty,
      ownedQty: 0,
    };
  }

  const catalog = await loadContainerCatalog(businessId);
  const catalogIds = new Set(catalog.map((row) => row.id));
  const ownedQty = sumOwnedContainerQuantity(customer.possession, catalogIds);

  if (refillQty <= ownedQty) {
    return {
      upgraded: false,
      effectivePolicy: "byog",
      refillQty,
      ownedQty,
    };
  }

  const nextPossession = { ...(customer.possession || {}) };
  for (const id of catalogIds) {
    delete nextPossession[id];
  }

  await CustomerService.updateCustomer(businessId, customerId, {
    containerPolicy: "wrs_rotation",
    possession: nextPossession,
  } as Record<string, unknown>);

  return {
    upgraded: true,
    effectivePolicy: "wrs_rotation",
    refillQty,
    ownedQty,
  };
}
