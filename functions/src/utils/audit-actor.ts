/**
 * Normalize audit actor fields for transaction history ("By …").
 */

export function isCustomerAuditUserId(userId?: string): boolean {
  const id = userId?.trim().toLowerCase() ?? "";
  return (
    id === "portal_customer" ||
    id === "customer" ||
    id.startsWith("customer:") ||
    id.startsWith("portal_customer")
  );
}

export function buildAuditActorFields(
  userId?: string,
  userName?: string,
): {
  userId?: string;
  userName?: string;
  userType?: "customer" | "staff" | "rider" | "system";
} {
  const id = userId?.trim();
  if (!id) {
    const name = userName?.trim();
    return name ? { userName: name } : {};
  }

  if (isCustomerAuditUserId(id)) {
    return {
      userId: id,
      userName: "Customer",
      userType: "customer",
    };
  }

  if (id.startsWith("rider_messenger:")) {
    const name = userName?.trim();
    return {
      userId: id,
      userName: name || "Rider",
      userType: "rider",
    };
  }

  if (id === "SYSTEM" || id.toLowerCase() === "system") {
    return { userId: id, userName: "System", userType: "system" };
  }

  const name = userName?.trim();
  return {
    userId: id,
    ...(name ? { userName: name } : {}),
    userType: "staff",
  };
}
