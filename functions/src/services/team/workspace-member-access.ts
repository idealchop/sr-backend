import { db, FieldValue, Timestamp } from "../../config/firebase-admin";

export const WORKSPACE_MEMBER_DEACTIVATED_MESSAGE =
  "Your account is deactivated. Contact your manager to activate your access.";

export const WORKSPACE_ACCESS_REVOKED_MESSAGE =
  "You no longer have access to this workspace. Contact your manager to be re-invited.";

export type WorkspaceLoginAccessCode =
  | "WORKSPACE_MEMBER_INACTIVE"
  | "WORKSPACE_ACCESS_REVOKED"
  | "WORKSPACE_NOT_FOUND";

/**
 * True when a member doc counts toward admin/rider seat limits (active, non-owner).
 * @param {string} memberId Member document id.
 * @param {object} member Member fields.
 * @param {boolean} [member.isActive] Active flag.
 * @param {string} [member.role] Workspace role.
 * @param {string} ownerId Business owner uid.
 * @return {boolean} Whether the member counts toward seat limits.
 */
export function isActiveStaffMemberForLimit(
  memberId: string,
  member: { isActive?: boolean; role?: string },
  ownerId: string,
): boolean {
  if (member.isActive === false) return false;
  if (memberId === ownerId) return false;
  const role = String(member.role || "").toLowerCase();
  if (role === "owner") return false;
  return true;
}

/**
 * Returns false when the user is a deactivated workspace member (non-owner).
 * @param {string} businessId Business id.
 * @param {string} uid Firebase auth uid.
 * @return {Promise<object>} Login gate result with allowed flag and optional message/code.
 */
export async function isWorkspaceMemberLoginAllowed(
  businessId: string,
  uid: string,
): Promise<{
  allowed: boolean;
  message?: string;
  code?: WorkspaceLoginAccessCode;
}> {
  const businessRef = db.collection("businesses").doc(businessId);
  const [bizSnap, memberSnap] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").doc(uid).get(),
  ]);

  if (!bizSnap.exists) {
    return {
      allowed: false,
      message: "Workspace not found.",
      code: "WORKSPACE_NOT_FOUND",
    };
  }

  if (bizSnap.data()?.ownerId === uid) {
    return { allowed: true };
  }

  if (!memberSnap.exists) {
    return {
      allowed: false,
      message: WORKSPACE_ACCESS_REVOKED_MESSAGE,
      code: "WORKSPACE_ACCESS_REVOKED",
    };
  }

  const isActive = memberSnap.data()?.isActive !== false;
  if (!isActive) {
    return {
      allowed: false,
      message: WORKSPACE_MEMBER_DEACTIVATED_MESSAGE,
      code: "WORKSPACE_MEMBER_INACTIVE",
    };
  }

  return { allowed: true };
}

/**
 * Re-grants Smart Refill app access after invite accept (clears prior removal flags).
 * @param {unknown} existing Prior `users.appAccess` array value.
 * @param {object} grant Workspace grant payload.
 * @param {string} grant.businessId Business id.
 * @param {string} [grant.role] Workspace role.
 * @param {boolean} [grant.onboardingComplete] Onboarding flag.
 * @return {Record<string, unknown>[]} Updated app access rows.
 */
export function mergeGrantedSmartrefillAppAccess(
  existing: unknown,
  grant: {
    businessId: string;
    role?: string;
    onboardingComplete?: boolean;
  },
): Record<string, unknown>[] {
  const appAccess = Array.isArray(existing) ?
    [...(existing as Record<string, unknown>[])] :
    [];
  const idx = appAccess.findIndex(
    (row) => String(row?.appId || "") === "smartrefill",
  );
  const nextRow: Record<string, unknown> = {
    appId: "smartrefill",
    role: grant.role ?? "staff",
    businessId: grant.businessId,
    onboardingComplete: grant.onboardingComplete ?? false,
  };

  if (idx >= 0) {
    const prev = appAccess[idx] as Record<string, unknown>;
    const rest = { ...prev };
    delete rest.accessRevoked;
    delete rest.revokedAt;
    appAccess[idx] = { ...rest, ...nextRow };
  } else {
    appAccess.push(nextRow);
  }

  return appAccess;
}

/**
 * Marks Smart Refill app access revoked after a member is removed from a workspace.
 * @param {string} userId Firebase auth uid.
 * @param {string} businessId Business id.
 * @return {Promise<void>}
 */
export async function revokeUserSmartrefillWorkspaceAccess(
  userId: string,
  businessId: string,
): Promise<void> {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return;

  const existingAccess = userSnap.data()?.appAccess;
  const appAccess = Array.isArray(existingAccess) ? [...existingAccess] : [];

  const idx = appAccess.findIndex(
    (row: { appId?: string; businessId?: string }) =>
      row?.appId === "smartrefill" &&
      String(row.businessId || "") === businessId,
  );
  if (idx < 0) return;

  // serverTimestamp() is not supported inside array elements — use Timestamp.now().
  appAccess[idx] = {
    ...(appAccess[idx] as Record<string, unknown>),
    accessRevoked: true,
    onboardingComplete: false,
    staffOnboardingComplete: false,
    revokedAt: Timestamp.now(),
  };

  await userRef.update({
    appAccess,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
