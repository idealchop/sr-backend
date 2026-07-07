import { db, FieldValue } from "../../config/firebase-admin";
import {
  DEFAULT_GETTING_STARTED,
  type GettingStartedKey,
} from "./business-onboarding-defaults";

export type GettingStartedFlags = Record<GettingStartedKey, boolean>;

type LegacyGettingStartedStored = Partial<GettingStartedFlags> & {
  addPaymentAccount?: boolean;
  addCollection?: boolean;
};

function normalizeStoredGettingStarted(
  stored: LegacyGettingStartedStored | undefined,
): Partial<GettingStartedFlags> {
  if (!stored) return {};
  const normalized: Partial<GettingStartedFlags> = { ...stored };
  if (stored.addPaymentAccount === true) {
    normalized.addOnlinePayments = true;
  }
  return normalized;
}

/**
 * Derives checklist completion from Firestore collections (source of truth).
 * @param {string} businessId The business ID.
 * @param {Object} [options] Additional options like email verification.
 * @return {Promise<Object>} The detected flags.
 */
export async function detectGettingStartedFromCollections(
  businessId: string,
  options?: { emailVerified?: boolean },
): Promise<Partial<GettingStartedFlags>> {
  const bizRef = db.collection("businesses").doc(businessId);

  const [
    inventorySnap,
    customersSnap,
    deliverySnap,
    walkinSnap,
    expenseSnap,
    aiSnap,
    paymentInfoSnap,
  ] = await Promise.all([
    bizRef.collection("inventory_items").limit(1).get(),
    bizRef.collection("customers").limit(1).get(),
    bizRef.collection("transactions").where("type", "==", "delivery").limit(1).get(),
    bizRef
      .collection("transactions")
      .where("type", "in", ["walkin", "direct_sale"])
      .limit(1)
      .get(),
    bizRef.collection("transactions").where("type", "==", "expense").limit(1).get(),
    bizRef.collection("ai_tool_runs").limit(1).get(),
    bizRef.collection("payment_info").limit(1).get(),
  ]);

  const detected: Partial<GettingStartedFlags> = {
    addOnlinePayments: !paymentInfoSnap.empty,
    addInventory: !inventorySnap.empty,
    addCustomer: !customersSnap.empty,
    addDelivery: !deliverySnap.empty,
    addWalkin: !walkinSnap.empty,
    addExpense: !expenseSnap.empty,
    useAi: !aiSnap.empty,
  };

  if (options?.emailVerified === true) {
    detected.verifyEmail = true;
  }

  return detected;
}

function mergeGettingStartedFlags(
  stored: LegacyGettingStartedStored | undefined,
  detected: Partial<GettingStartedFlags>,
): GettingStartedFlags {
  const merged = { ...DEFAULT_GETTING_STARTED, ...normalizeStoredGettingStarted(stored) };
  for (const key of Object.keys(DEFAULT_GETTING_STARTED) as GettingStartedKey[]) {
    if (detected[key] === true) {
      merged[key] = true;
    }
  }
  return merged;
}

/**
 * Promotes detected checklist flags onto the business doc when collections prove completion.
 * @param {string} businessId The business ID.
 * @param {Object} [options] Additional options.
 * @return {Promise<Object>} The sync result.
 */
export async function syncGettingStartedOnBusiness(
  businessId: string,
  options?: { emailVerified?: boolean },
): Promise<{
  gettingStarted: GettingStartedFlags;
  updated: boolean;
  patch: Partial<GettingStartedFlags>;
}> {
  const ref = db.collection("businesses").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Business not found");
  }

  const stored = snap.data()?.gettingStarted as LegacyGettingStartedStored | undefined;
  const normalizedStored = normalizeStoredGettingStarted(stored);
  const detected = await detectGettingStartedFromCollections(businessId, options);
  const merged = mergeGettingStartedFlags(stored, detected);

  const patch: Partial<GettingStartedFlags> = {};
  for (const key of Object.keys(DEFAULT_GETTING_STARTED) as GettingStartedKey[]) {
    if (merged[key] && !normalizedStored?.[key]) {
      patch[key] = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { gettingStarted: merged, updated: false, patch: {} };
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const [k, v] of Object.entries(patch)) {
    updates[`gettingStarted.${k}`] = v;
  }
  await ref.update(updates);

  return { gettingStarted: merged, updated: true, patch };
}
