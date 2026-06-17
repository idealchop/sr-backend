import { createHash } from "node:crypto";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";

export type OwnerDevicePlatform = "ios" | "android" | "web";

export type OwnerDevice = {
  id: string;
  userId: string;
  fcmToken: string;
  platform: OwnerDevicePlatform;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function tokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 40);
}

function normalizePlatform(raw: unknown): OwnerDevicePlatform {
  if (raw === "ios" || raw === "android" || raw === "web") return raw;
  return "android";
}

function devicesCollection(businessId: string) {
  return db.collection("businesses").doc(businessId).collection("owner_devices");
}

/**
 * Registers or refreshes an owner FCM token for a business workspace.
 * @param {string} businessId Business id.
 * @param {string} userId Owner user id.
 * @param {Object} input Registration payload.
 * @param {string} input.fcmToken FCM registration token.
 * @param {unknown} [input.platform] Device platform hint.
 * @return {Promise<OwnerDevice>} Stored device record.
 */
export async function registerOwnerDevice(
  businessId: string,
  userId: string,
  input: { fcmToken: string; platform?: unknown },
): Promise<OwnerDevice> {
  const fcmToken = String(input.fcmToken || "").trim();
  if (!fcmToken) {
    throw new Error("FCM token is required");
  }

  const docId = tokenDocId(fcmToken);
  const ref = devicesCollection(businessId).doc(docId);
  const payload = {
    userId,
    fcmToken,
    platform: normalizePlatform(input.platform),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.set(payload, { merge: true });
  }

  return {
    id: docId,
    userId,
    fcmToken,
    platform: normalizePlatform(input.platform),
  };
}

/**
 * Lists registered owner devices for a business.
 * @param {string} businessId Business id.
 * @return {Promise<Array<OwnerDevice>>} Registered devices.
 */
export async function listOwnerDevices(businessId: string): Promise<OwnerDevice[]> {
  const snap = await devicesCollection(businessId).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: String(data.userId || ""),
      fcmToken: String(data.fcmToken || ""),
      platform: normalizePlatform(data.platform),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

/**
 * Removes a registered device document.
 * @param {string} businessId Business id.
 * @param {string} deviceId Owner device document id.
 * @return {Promise<void>}
 */
export async function deleteOwnerDevice(
  businessId: string,
  deviceId: string,
): Promise<void> {
  await devicesCollection(businessId).doc(deviceId).delete();
}

/**
 * Deletes stale tokens after FCM invalidation responses.
 * @param {string} businessId Business id.
 * @param {Array<string>} tokens Invalid FCM tokens.
 * @return {Promise<void>}
 */
export async function deleteOwnerDevicesByTokens(
  businessId: string,
  tokens: string[],
): Promise<void> {
  const ids = tokens.map((token) => tokenDocId(token));
  const batch = db.batch();
  for (const id of ids) {
    batch.delete(devicesCollection(businessId).doc(id));
  }
  await batch.commit();
  if (ids.length > 0) {
    logger.info("Removed invalid owner FCM tokens", {
      businessId,
      count: ids.length,
    });
  }
}

/**
 * Distinct business IDs that have at least one registered owner device.
 * @param {number} [limit] Max device docs to scan.
 * @return {Promise<Array<string>>} Business ids.
 */
export async function listBusinessIdsWithOwnerDevices(
  limit = 500,
): Promise<string[]> {
  const snap = await db.collectionGroup("owner_devices").limit(limit).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const businessId = doc.ref.parent.parent?.id;
    if (businessId) ids.add(businessId);
  }
  return [...ids];
}
