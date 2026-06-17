import * as admin from "firebase-admin";
import {
  SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS,
  SUBSCRIPTION_PLAN_LIMITATION_PATCHES,
  SUBSCRIPTION_PLAN_SYNC_CODES,
} from "../config/subscription-plans-catalog";
import { subscriptionPlanRowMatchesCode } from "../utils/subscription-addon-plan-limits";

function mergeLimitations(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...(existing || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === "object" &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeLimitations(
        next[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      next[key] = value;
    }
  }
  return next;
}

async function syncSubscriptionPlans() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const snap = await db.collection("subscription_plans").get();

  if (snap.empty) {
    console.warn(
      "No subscription_plans documents found. Create plan rows in Firestore first, then re-run.",
    );
    return;
  }

  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const code = String(data.code || doc.id || "").toLowerCase();
    const patch =
      SUBSCRIPTION_PLAN_LIMITATION_PATCHES[code] ??
      SUBSCRIPTION_PLAN_SYNC_CODES.map((c) =>
        subscriptionPlanRowMatchesCode(data, c) ?
          SUBSCRIPTION_PLAN_LIMITATION_PATCHES[c] :
          null,
      ).find(Boolean);

    if (!patch) {
      console.log(`Skip ${doc.id} (code=${code}) — no catalog patch`);
      continue;
    }

    const limitations = mergeLimitations(
      (data.limitations as Record<string, unknown> | undefined) ?? undefined,
      patch,
    );

    for (const legacyKey of SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS) {
      delete limitations[legacyKey];
    }

    const payload: Record<string, unknown> = {
      limitations,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    for (const legacyKey of SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS) {
      payload[`limitations.${legacyKey}`] = admin.firestore.FieldValue.delete();
    }

    await doc.ref.set(payload, { merge: true });
    updated += 1;
    console.log(`Updated subscription_plans/${doc.id} (code=${code})`);
  }

  console.log(`Done. Patched ${updated} plan document(s).`);
}

syncSubscriptionPlans().catch((err) => {
  console.error("sync-subscription-plans failed:", err);
  process.exit(1);
});
