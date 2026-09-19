import { db } from "../../config/firebase-admin";
import { isCatalogLiveForNewSales } from "../../utils/catalog-publication";
import {
  DEFAULT_TRIAL_POLICY,
  parseTrialPolicy,
  TRIAL_POLICY_COLLECTION,
  TRIAL_POLICY_DOC_ID,
  type TrialPolicy,
} from "./trial-policy";

export async function loadEffectiveTrialPolicy(
  now = new Date(),
): Promise<TrialPolicy> {
  try {
    const snap = await db
      .collection(TRIAL_POLICY_COLLECTION)
      .doc(TRIAL_POLICY_DOC_ID)
      .get();
    if (!snap.exists) return { ...DEFAULT_TRIAL_POLICY };
    const data = snap.data() as Record<string, unknown>;
    if (!isCatalogLiveForNewSales({ ...data, isActive: data.isActive !== false }, now)) {
      return { ...DEFAULT_TRIAL_POLICY };
    }
    return parseTrialPolicy(data);
  } catch {
    return { ...DEFAULT_TRIAL_POLICY };
  }
}
