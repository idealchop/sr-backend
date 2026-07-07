/** Container-like inventory names (matches frontend delivery-container-lines). */
export function isContainerInventoryName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("container") ||
    lower.includes("bottle") ||
    lower.includes("slim") ||
    lower.includes("round") ||
    lower.includes("gallon")
  );
}

export type ContainerCatalogRow = { id: string; name: string };

export function sumOwnedContainerQuantity(
  possession: Record<string, { quantity?: number }> | undefined,
  containerCatalogIds: ReadonlySet<string>,
): number {
  let total = 0;
  for (const [id, row] of Object.entries(possession || {})) {
    if (!containerCatalogIds.has(id)) continue;
    total += Math.max(0, Number(row?.quantity) || 0);
  }
  return total;
}

export function sumRefillQuantity(
  refillItems?: Array<{ qty?: number }> | null,
): number {
  if (!Array.isArray(refillItems)) return 0;
  return refillItems.reduce(
    (acc, row) => acc + Math.max(0, Number(row.qty) || 0),
    0,
  );
}
