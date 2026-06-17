import { db } from "../config/firebase-admin";

export type VerificationAudience = "owner" | "staff";

// eslint-disable-next-line valid-jsdoc
/**
 * Resolves whether verification emails and landing pages should use owner or staff flows.
 */
export async function resolveVerificationAudience(
  uid: string,
): Promise<VerificationAudience> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) return "owner";

  const userData = userDoc.data();
  const appAccess = (userData?.appAccess || []) as Array<{
    appId?: string;
    businessId?: string;
    role?: string;
  }>;
  const smartRefillAccess = appAccess.find((a) => a.appId === "smartrefill");
  const businessId = (smartRefillAccess?.businessId as string) || null;

  const ownedSnap = await db
    .collection("businesses")
    .where("ownerId", "==", uid)
    .limit(1)
    .get();
  if (!businessId && !ownedSnap.empty) {
    return "owner";
  }

  if (businessId) {
    const businessRef = db.collection("businesses").doc(businessId);
    const [bizSnap, memberSnap] = await Promise.all([
      businessRef.get(),
      businessRef.collection("members").doc(uid).get(),
    ]);
    if (bizSnap.exists && bizSnap.data()?.ownerId === uid) {
      return "owner";
    }
    if (memberSnap.exists) {
      const role = String(memberSnap.data()?.role || "rider");
      if (role === "admin" || role === "rider" || role === "staff") {
        return "staff";
      }
    }
    const ar = smartRefillAccess?.role;
    if (ar === "admin" || ar === "rider" || ar === "staff") {
      return "staff";
    }
  }

  return "owner";
}

export function verificationPathForAudience(
  audience: VerificationAudience,
): string {
  return audience === "staff" ? "/staff-verified" : "/verified";
}

export type StaffVerificationContext = {
  workspaceName?: string;
  memberRole?: string;
};

/**
 * Workspace name + seat role for staff verification email personalization.
 * @param {string} uid Firebase Auth user id.
 * @return {Promise<StaffVerificationContext>}
 */
export async function resolveStaffVerificationContext(
  uid: string,
): Promise<StaffVerificationContext> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) return {};

  const userData = userDoc.data();
  const appAccess = (userData?.appAccess || []) as Array<{
    appId?: string;
    businessId?: string;
    role?: string;
  }>;
  const smartRefillAccess = appAccess.find((a) => a.appId === "smartrefill");
  const businessId = (smartRefillAccess?.businessId as string) || null;
  if (!businessId) return {};

  const businessRef = db.collection("businesses").doc(businessId);
  const [bizSnap, memberSnap] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").doc(uid).get(),
  ]);

  const bizData = bizSnap.data();
  const workspaceName =
    typeof bizData?.name === "string" ?
      bizData.name.trim() :
      undefined;
  const memberRole = memberSnap.exists ?
    String(memberSnap.data()?.role || smartRefillAccess?.role || "").trim() :
    String(smartRefillAccess?.role || "").trim();

  return {
    workspaceName: workspaceName || undefined,
    memberRole: memberRole || undefined,
  };
}
