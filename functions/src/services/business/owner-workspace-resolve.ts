import type {
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import type { AppAccessRow } from "../../utils/smartrefill-app-access";

function getSmartrefillAccess(appAccess: unknown): AppAccessRow | undefined {
  if (!Array.isArray(appAccess)) return undefined;
  return appAccess.find(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as AppAccessRow).appId || "").toLowerCase() === "smartrefill",
  ) as AppAccessRow | undefined;
}

function isOwnerBusiness(snap: DocumentSnapshot, uid: string): boolean {
  return snap.exists && snap.data()?.ownerId === uid;
}

/**
 * Resolves the owner's workspace document (appAccess link, user lock, or ownerId query).
 * @param {string} uid - The user ID
 * @return {Promise<DocumentReference | null>} The business document reference
 */
export async function resolveExistingOwnerBusinessRef(
  uid: string,
): Promise<DocumentReference | null> {
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data();

  const linkedId = getSmartrefillAccess(userData?.appAccess)?.businessId;
  if (linkedId) {
    const ref = db.collection("businesses").doc(linkedId);
    const snap = await ref.get();
    if (isOwnerBusiness(snap, uid)) return ref;
  }

  const lockId =
    typeof userData?.ownerWorkspaceId === "string" ?
      userData.ownerWorkspaceId :
      "";
  if (lockId) {
    const ref = db.collection("businesses").doc(lockId);
    const snap = await ref.get();
    if (isOwnerBusiness(snap, uid)) return ref;
  }

  const ownedSnap = await db
    .collection("businesses")
    .where("ownerId", "==", uid)
    .limit(1)
    .get();

  if (!ownedSnap.empty) return ownedSnap.docs[0].ref;
  return null;
}

/**
 * Creates owner workspace + member in a transaction, or returns an existing ref if another
 * request won the race (prevents duplicate `businesses` docs on double submit).
 * @param {object} params - The creation parameters
 * @return {Promise<object>} The created business doc
 */
export async function getOrCreateOwnerBusinessRef(params: {
  uid: string;
  email?: string;
  name?: string;
}): Promise<{ ref: DocumentReference; created: boolean }> {
  const existing = await resolveExistingOwnerBusinessRef(params.uid);
  if (existing) return { ref: existing, created: false };

  const userRef = db.collection("users").doc(params.uid);

  const ref = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.data();

    const fromApp = getSmartrefillAccess(userData?.appAccess)?.businessId;
    if (fromApp) {
      const bizRef = db.collection("businesses").doc(fromApp);
      const bizSnap = await tx.get(bizRef);
      if (isOwnerBusiness(bizSnap, params.uid)) return bizRef;
    }

    const lockId =
      typeof userData?.ownerWorkspaceId === "string" ?
        userData.ownerWorkspaceId :
        "";
    if (lockId) {
      const bizRef = db.collection("businesses").doc(lockId);
      const bizSnap = await tx.get(bizRef);
      if (bizSnap.exists && bizSnap.data()?.ownerId === params.uid) return bizRef;
    }

    const businessRef = db.collection("businesses").doc();
    const memberRef = businessRef.collection("members").doc(params.uid);

    tx.set(businessRef, {
      ownerId: params.uid,
      email: params.email || "",
      name: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      onboardingComplete: false,
    });

    tx.set(memberRef, {
      userId: params.uid,
      email: params.email || "",
      name: params.name || "Owner",
      role: "owner",
      joinedAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, { ownerWorkspaceId: businessRef.id }, { merge: true });

    return businessRef;
  });

  return { ref, created: true };
}
