import { db } from "../config/firebase-admin";

export type AppAccessRow = {
  appId?: string;
  role?: string;
  onboardingComplete?: boolean;
  businessId?: string;
  staffOnboardingComplete?: boolean;
};

export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hasSmartrefillAppAccess(appAccess: unknown): boolean {
  if (!Array.isArray(appAccess)) return false;
  return appAccess.some(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as AppAccessRow).appId || "").toLowerCase() === "smartrefill",
  );
}

/**
 * True when this Firebase uid (or any `users` doc with the same email) has Smart Refill access.
 * @param {string} uid The user's UID.
 * @param {string} email The user's email address.
 * @return {Promise<Object>}
 */
export async function resolveSmartrefillAccessForUser(
  uid: string,
  email: string,
): Promise<{ hasSmartrefillAccess: boolean; hasFirestoreDoc: boolean }> {
  const userDoc = await db.collection("users").doc(uid).get();
  const uidData = userDoc.exists ? userDoc.data() : undefined;
  let hasSmartrefillAccess = hasSmartrefillAppAccess(uidData?.appAccess);

  const emailNorm = normalizeUserEmail(email);
  if (!hasSmartrefillAccess && emailNorm.length > 0) {
    const snap = await db
      .collection("users")
      .where("email", "==", emailNorm)
      .limit(10)
      .get();
    hasSmartrefillAccess = snap.docs.some((d) =>
      hasSmartrefillAppAccess(d.data()?.appAccess),
    );
  }

  return {
    hasSmartrefillAccess,
    hasFirestoreDoc: userDoc.exists,
  };
}

/**
 * Firestore-only check by email (for pre-auth registration preview).
 * @param {string} email The user's email address.
 * @return {Promise<boolean>} True if the email has Smart Refill access.
 */
export async function hasSmartrefillAccessForEmail(
  email: string,
): Promise<boolean> {
  const emailNorm = normalizeUserEmail(email);
  if (!emailNorm) return false;
  const snap = await db
    .collection("users")
    .where("email", "==", emailNorm)
    .limit(10)
    .get();
  return snap.docs.some((d) => hasSmartrefillAppAccess(d.data()?.appAccess));
}

export function buildSmartrefillOwnerAccessEntry(): AppAccessRow {
  return {
    appId: "smartrefill",
    role: "owner",
    onboardingComplete: false,
  };
}

/**
 * Ensures `smartrefill` appAccess marks onboarding done and links the workspace.
 * @param {unknown} appAccess The current appAccess array.
 * @param {string} businessId The business ID to link.
 * @return {AppAccessRow[]} The updated appAccess array.
 */
export function markSmartrefillOnboardingComplete(
  appAccess: unknown,
  businessId: string,
): AppAccessRow[] {
  const rows = Array.isArray(appAccess) ? [...(appAccess as AppAccessRow[])] : [];
  const idx = rows.findIndex(
    (row) =>
      row &&
      typeof row === "object" &&
      String(row.appId || "").toLowerCase() === "smartrefill",
  );

  if (idx >= 0) {
    rows[idx] = {
      ...rows[idx],
      appId: "smartrefill",
      onboardingComplete: true,
      businessId,
    };
    return rows;
  }

  rows.push({
    ...buildSmartrefillOwnerAccessEntry(),
    onboardingComplete: true,
    businessId,
  });
  return rows;
}
