import { auth, db, FieldValue } from "../config/firebase-admin";
import {
  AppAccessRow,
  buildSmartrefillOwnerAccessEntry,
  hasSmartrefillAppAccess,
  markSmartrefillOnboardingComplete,
  normalizeUserEmail,
} from "./smartrefill-app-access";

export type UpsertUserProfileParams = {
  uid: string;
  email?: string;
  bodyFullName?: string;
  /** From decoded ID token (`name` claim), if present. */
  idTokenName?: string;
  /** Push `smartrefill` owner access when absent (signup / grant access). */
  grantSmartrefillAccess?: boolean;
  businessId?: string;
  markOwnerOnboardingComplete?: boolean;
};

/**
 * Merge Firestore `users/{uid}` with Firebase Auth profile fields (email, display name, photo).
 * Always sets uid, email, displayName, fullName, updatedAt; sets createdAt on first write.
 * @param {UpsertUserProfileParams} params The parameters
 */
export async function upsertSmartrefillUserProfile(
  params: UpsertUserProfileParams,
): Promise<void> {
  const { uid } = params;
  let email = normalizeUserEmail(params.email || "");
  let displayName = (params.bodyFullName || "").trim();
  let photoURL = "";

  try {
    const record = await auth.getUser(uid);
    if (!email && record.email) {
      email = normalizeUserEmail(record.email);
    }
    displayName =
      displayName ||
      record.displayName?.trim() ||
      (params.idTokenName || "").trim() ||
      email.split("@")[0] ||
      "Verified User";
    photoURL = record.photoURL || "";
  } catch {
    displayName =
      displayName ||
      (params.idTokenName || "").trim() ||
      (email ? email.split("@")[0] : "Verified User");
  }

  if (!email) {
    throw new Error("Email is required to sync user profile");
  }

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const existing = snap.exists ? snap.data() : undefined;

  let appAccess: AppAccessRow[];
  if (params.businessId) {
    appAccess = markSmartrefillOnboardingComplete(
      existing?.appAccess,
      params.businessId,
    );
  } else if (params.grantSmartrefillAccess) {
    const rows = Array.isArray(existing?.appAccess) ?
      [...(existing.appAccess as AppAccessRow[])] :
      [];
    if (!hasSmartrefillAppAccess(rows)) {
      rows.push(buildSmartrefillOwnerAccessEntry());
    }
    appAccess = rows;
  } else {
    appAccess = Array.isArray(existing?.appAccess) ?
      [...(existing.appAccess as AppAccessRow[])] :
      [];
  }

  const payload: Record<string, unknown> = {
    uid,
    email,
    displayName,
    fullName: displayName,
    photoURL: photoURL || (existing?.photoURL as string) || "",
    appAccess,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (params.markOwnerOnboardingComplete) {
    payload.onboardingComplete = true;
  } else if (!snap.exists) {
    payload.onboardingComplete = false;
  }

  if (!existing?.createdAt) {
    payload.createdAt = FieldValue.serverTimestamp();
  }

  await userRef.set(payload, { merge: true });
}
