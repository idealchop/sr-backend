/** Mask customer name for public portal display (e.g. John Doe → J****e). */
export function maskPortalCustomerName(name: string | undefined): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "Customer";

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? trimmed;
  const last = parts.length > 1 ? parts[parts.length - 1]! : first;

  if (parts.length === 1) {
    if (first.length <= 1) return "*";
    if (first.length === 2) return `${first[0]}*`;
    return `${first[0]}${"*".repeat(Math.max(1, first.length - 2))}${first[first.length - 1]}`;
  }

  const firstChar = first[0] ?? "";
  const lastChar = last[last.length - 1] ?? "";
  if (!firstChar || !lastChar) return "Customer";
  return `${firstChar}${"*".repeat(4)}${lastChar}`;
}
