import { isContainerInventoryName } from "../inventory/container-catalog-utils";
import { customerUsesWrContainerRotation } from "./container-policy";

export type CustomerContainerDeposit = {
  balance: number;
  shellsCovered: number;
  updatedAt: string;
};

export function normalizeCustomerContainerDeposit(
  value: unknown,
): CustomerContainerDeposit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const balance = Number(raw.balance);
  const shellsCovered = Number(raw.shellsCovered);
  const updatedAt =
    typeof raw.updatedAt === "string" ? raw.updatedAt.trim() : "";
  if (!Number.isFinite(balance) || balance < 0) return null;
  if (!Number.isFinite(shellsCovered) || shellsCovered < 0) return null;
  if (!updatedAt) return null;
  return {
    balance: Math.round(balance * 100) / 100,
    shellsCovered: Math.floor(shellsCovered),
    updatedAt,
  };
}

export function sumWrShellPossession(
  possession: Record<string, { quantity?: number }> | undefined,
  shellIds: ReadonlySet<string>,
): number {
  let total = 0;
  for (const [id, row] of Object.entries(possession || {})) {
    if (!shellIds.has(id)) continue;
    total += Math.max(0, Number(row?.quantity) || 0);
  }
  return total;
}

export function buildShellIdSet(
  inventory: Array<{ id: string; name: string; inventoryRole?: unknown }>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of inventory) {
    const role = item.inventoryRole;
    const isShell =
      role === "container_shell" ||
      (role !== "kit_component" && isContainerInventoryName(item.name));
    if (isShell) ids.add(item.id);
  }
  return ids;
}

export type ContainerDepositGap = {
  wrsShellCount: number;
  shellsCovered: number;
  uncoveredShells: number;
  depositBalance: number;
  hasGap: boolean;
};

export function computeContainerDepositGap(
  customer: {
    containerPolicy?: unknown;
    possession?: Record<string, { quantity?: number }>;
    containerDeposit?: unknown;
  } | null | undefined,
  business: {
    containerDefaultPolicy?: unknown;
  } | null | undefined,
  shellIds: ReadonlySet<string>,
): ContainerDepositGap | null {
  if (!customerUsesWrContainerRotation(customer, business)) return null;
  const deposit = normalizeCustomerContainerDeposit(customer?.containerDeposit);
  const wrsShellCount = sumWrShellPossession(customer?.possession, shellIds);
  const shellsCovered = deposit?.shellsCovered ?? 0;
  const uncoveredShells = Math.max(0, wrsShellCount - shellsCovered);
  return {
    wrsShellCount,
    shellsCovered,
    uncoveredShells,
    depositBalance: deposit?.balance ?? 0,
    hasGap: uncoveredShells > 0,
  };
}
