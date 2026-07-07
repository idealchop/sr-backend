/** Station-wide default for new sukis (portal, community, CRM). */
export type ContainerDefaultPolicy = "wrs_rotation" | "byog";

/** Per-customer override; `unspecified` inherits the station default. */
export type CustomerContainerPolicy =
  | "unspecified"
  | "wrs_rotation"
  | "byog";

export const DEFAULT_CONTAINER_DEFAULT_POLICY: ContainerDefaultPolicy =
  "wrs_rotation";

export function normalizeContainerDefaultPolicy(
  value: unknown,
): ContainerDefaultPolicy {
  return value === "byog" ? "byog" : DEFAULT_CONTAINER_DEFAULT_POLICY;
}

export function normalizeCustomerContainerPolicy(
  value: unknown,
): CustomerContainerPolicy {
  if (value === "byog" || value === "wrs_rotation") return value;
  return "unspecified";
}

export function getBusinessContainerDefaultPolicy(
  business: Record<string, unknown> | null | undefined,
): ContainerDefaultPolicy {
  return normalizeContainerDefaultPolicy(business?.containerDefaultPolicy);
}

export function resolveContainerPolicy(
  customerPolicy: unknown,
  businessDefault?: unknown,
): ContainerDefaultPolicy {
  const normalized = normalizeCustomerContainerPolicy(customerPolicy);
  if (normalized === "byog" || normalized === "wrs_rotation") {
    return normalized;
  }
  return normalizeContainerDefaultPolicy(businessDefault);
}

export function isByogContainerPolicy(
  policy: ContainerDefaultPolicy,
): boolean {
  return policy === "byog";
}

export function customerUsesWrContainerRotation(
  customer: { containerPolicy?: unknown } | null | undefined,
  businessDefault?: unknown,
): boolean {
  const effective = resolveContainerPolicy(
    customer?.containerPolicy,
    businessDefault,
  );
  return !isByogContainerPolicy(effective);
}
