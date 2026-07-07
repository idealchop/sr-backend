import { isContainerInventoryName } from "./container-catalog-utils";

export type InventoryItemRole =
  | "container_shell"
  | "container_round"
  | "container_slim"
  | "kit_component"
  | "general";

export const CONTAINER_SHAPE_ROLES = ["container_round", "container_slim"] as const;
export type ContainerShapeRole = (typeof CONTAINER_SHAPE_ROLES)[number];

export function isContainerShapeRole(role: InventoryItemRole): role is ContainerShapeRole {
  return role === "container_round" || role === "container_slim";
}

export function normalizeInventoryItemRole(value: unknown): InventoryItemRole {
  if (
    value === "container_shell" ||
    value === "container_round" ||
    value === "container_slim" ||
    value === "kit_component"
  ) {
    return value;
  }
  return "general";
}

export function inferInventoryItemRole(name: string, explicit?: unknown): InventoryItemRole {
  const normalized = normalizeInventoryItemRole(explicit);
  if (normalized !== "general") return normalized;
  return isContainerInventoryName(name) ? "container_shell" : "general";
}

export class DuplicateContainerShapeRoleError extends Error {
  constructor(
    public role: ContainerShapeRole,
    public existingItemName: string,
  ) {
    const label = role === "container_round" ? "Round" : "Slim";
    super(
      `${label} container role is already assigned to "${existingItemName}".`,
    );
    this.name = "DuplicateContainerShapeRoleError";
  }
}

export async function assertUniqueContainerShapeRole(
  businessId: string,
  role: InventoryItemRole,
  excludeItemId?: string,
): Promise<void> {
  if (!isContainerShapeRole(role)) return;

  const { db } = await import("../../config/firebase-admin");
  const snapshot = await db
    .collection("businesses")
    .doc(businessId)
    .collection("inventory_items")
    .where("inventoryRole", "==", role)
    .limit(2)
    .get();

  const conflict = snapshot.docs.find((doc) => doc.id !== excludeItemId);
  if (!conflict) return;

  const existingName = String(conflict.data()?.name || "another item");
  throw new DuplicateContainerShapeRoleError(role, existingName);
}

export function resolveKitComponentIds(
  business: { containerKitComponentIds?: unknown } | null | undefined,
): string[] {
  const raw = business?.containerKitComponentIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

export function normalizeKitComponentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((id) => String(id || "").trim()).filter(Boolean);
}

export function normalizeSellingPrice(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function normalizeDefaultContainerDepositAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
