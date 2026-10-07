import * as admin from "firebase-admin";
import {
  SUBSCRIPTION_PLAN_CATALOG_ROWS,
  SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS,
  SUBSCRIPTION_PLAN_LIMITATION_PATCHES,
  SUBSCRIPTION_PLAN_SYNC_CODES,
} from "../config/subscription-plans-catalog";
import { defaultCapabilitiesForPlanCode } from "../utils/plan-capabilities";
import { DEFAULT_SMARTREFILL_APP_DOC_ID } from "../utils/app-subscription-plans";
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

async function upsertMissingCatalogPlans(
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const snap = await db.collection("subscription_plans").get();
  const existingCodes = new Set(
    snap.docs.map((doc) =>
      String(doc.data().code || doc.id || "").toLowerCase(),
    ),
  );

  for (const [code, row] of Object.entries(SUBSCRIPTION_PLAN_CATALOG_ROWS)) {
    if (existingCodes.has(code) || existingCodes.has(row.code)) continue;
    if (code === "pro" && (existingCodes.has("grow") || existingCodes.has("pro"))) {
      continue;
    }
    await db.collection("subscription_plans").doc(code).set({
      code: row.code,
      name: row.name,
      pricing: row.pricing,
      limitations: row.limitations,
      capabilities: defaultCapabilitiesForPlanCode(row.code),
      catalogStatus: "published",
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    existingCodes.add(code);
    console.log(`Created subscription_plans/${code}`);
  }
}

async function syncAppRegistry(
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const appId =
    process.env.SMARTREFILL_APP_DOC_ID || DEFAULT_SMARTREFILL_APP_DOC_ID;
  const snap = await db.collection("subscription_plans").get();
  const byCode = new Map<string, string>();
  for (const doc of snap.docs) {
    const code = String(doc.data().code || doc.id || "").toLowerCase();
    if (code) byCode.set(code, doc.id);
  }
  const subscriptionPlans: Record<string, string> = {};
  for (const key of ["free", "starter", "grow", "scale"] as const) {
    const id = byCode.get(key) || (key === "grow" ? byCode.get("pro") : undefined);
    if (id) subscriptionPlans[key] = id;
  }
  if (Object.keys(subscriptionPlans).length === 0) return;
  await db.collection("apps").doc(appId).set(
    { subscriptionPlans, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log(`Updated apps/${appId}.subscriptionPlans`, subscriptionPlans);
}

async function syncSubscriptionPlans() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  await upsertMissingCatalogPlans(db);
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
    const catalog = SUBSCRIPTION_PLAN_CATALOG_ROWS[code];
    if (catalog) {
      const status = String(data.catalogStatus || "published").toLowerCase();
      if (status === "published") {
        console.log(`Skip ${doc.id} (code=${code}) — published catalog; Sales Portal is source of truth`);
        continue;
      }
    }

    const patch =
      catalog?.limitations ??
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
    if (catalog) {
      payload.name = catalog.name;
      payload.code = catalog.code;
      payload.pricing = catalog.pricing;
      payload.isActive = true;
    }
    for (const legacyKey of SUBSCRIPTION_PLAN_LEGACY_LIMITATION_KEYS) {
      payload[`limitations.${legacyKey}`] = admin.firestore.FieldValue.delete();
    }

    await doc.ref.set(payload, { merge: true });
    updated += 1;
    console.log(`Updated subscription_plans/${doc.id} (code=${code})`);
  }

  await syncAppRegistry(db);
  await db.collection("subscription_addons").doc("addon_ai_boost").set(
    { isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log("Hid AI Operations Boost add-on (isActive=false).");
  console.log(`Done. Patched ${updated} plan document(s).`);
}

syncSubscriptionPlans().catch((err) => {
  console.error("sync-subscription-plans failed:", err);
  process.exit(1);
});
