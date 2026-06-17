import { db } from "../config/firebase-admin";

/**
 * Checks if a user has access to a specific business.
 * @param {string} uid The user ID.
 * @param {string} businessId The business ID.
 * @return {Promise<any>} The access results.
 */
export const checkBusinessAccess = async (
  uid: string,
  businessId: string,
): Promise<{
  hasAccess: boolean;
  role?: string;
  businessDoc?: any;
}> => {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();

  if (!businessDoc.exists) return { hasAccess: false };

  const data = businessDoc.data();
  if (data?.ownerId === uid) {
    return { hasAccess: true, role: "owner", businessDoc };
  }

  const memberDoc = await businessRef.collection("members").doc(uid).get();
  if (memberDoc.exists) {
    return {
      hasAccess: true,
      role: memberDoc.data()?.role || "member",
      businessDoc,
    };
  }

  return { hasAccess: false };
};
