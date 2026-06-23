import { db, FieldValue } from "../../config/firebase-admin";
import type { Customer } from "../customers/customer-service";
import type { DuplicateGroup } from "./duplicate-customers-service";

export const UI_CONFIG_DISMISSED_DUPLICATE_CUSTOMER_IDS =
  "dismissedDuplicateCustomerIds";

/** @deprecated Migrated into per-customer ids on read. */
export const UI_CONFIG_DISMISSED_DUPLICATE_GROUP_KEYS =
  "dismissedDuplicateGroupKeys";

export function readDismissedDuplicateCustomerIds(
  uiConfig?: Record<string, unknown> | null,
): Set<string> {
  const ids = new Set<string>();

  const rawIds = uiConfig?.[UI_CONFIG_DISMISSED_DUPLICATE_CUSTOMER_IDS];
  if (Array.isArray(rawIds)) {
    for (const id of rawIds) {
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }

  const legacyGroups = uiConfig?.[UI_CONFIG_DISMISSED_DUPLICATE_GROUP_KEYS];
  if (Array.isArray(legacyGroups)) {
    for (const key of legacyGroups) {
      if (typeof key !== "string" || !key) continue;
      for (const id of key.split("|")) {
        if (id) ids.add(id);
      }
    }
  }

  return ids;
}

export function excludeDismissedDuplicateCustomers(
  customers: Customer[],
  dismissedCustomerIds: Set<string>,
): Customer[] {
  if (dismissedCustomerIds.size === 0) return customers;
  return customers.filter(
    (customer) => customer.id && !dismissedCustomerIds.has(customer.id),
  );
}

export function filterDismissedDuplicateGroups(
  groups: DuplicateGroup[],
  dismissedCustomerIds: Set<string>,
): DuplicateGroup[] {
  if (dismissedCustomerIds.size === 0) return groups;

  const filtered: DuplicateGroup[] = [];
  for (const group of groups) {
    const members = group.customers.filter(
      (customer) => !dismissedCustomerIds.has(customer.id),
    );
    if (members.length < 2) continue;
    filtered.push({ ...group, customers: members });
  }
  return filtered;
}

export async function dismissDuplicateCustomer(params: {
  businessId: string;
  customerId: string;
}): Promise<{ customerId: string; dismissedDuplicateCustomerIds: string[] }> {
  const customerId = String(params.customerId || "").trim();
  if (!customerId) {
    throw new Error("customerId is required");
  }

  const businessRef = db.collection("businesses").doc(params.businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) {
    throw new Error("Business not found");
  }

  const uiConfig = (businessDoc.data()?.uiConfig ?? {}) as Record<
    string,
    unknown
  >;
  const existing = readDismissedDuplicateCustomerIds(uiConfig);
  existing.add(customerId);

  const dismissedDuplicateCustomerIds = [...existing].sort((a, b) =>
    a.localeCompare(b),
  );

  await businessRef.update({
    uiConfig: {
      ...uiConfig,
      [UI_CONFIG_DISMISSED_DUPLICATE_CUSTOMER_IDS]:
        dismissedDuplicateCustomerIds,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { customerId, dismissedDuplicateCustomerIds };
}
