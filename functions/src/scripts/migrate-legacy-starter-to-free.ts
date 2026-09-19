/**
 * One-shot: rewrite unpaid Starter subscription rows to Free on riverdb.
 *
 *   cd smartrefill/backend/functions
 *   npx ts-node src/scripts/migrate-legacy-starter-to-free.ts
 *
 * Paid Starter (₱399) is left unchanged.
 */
import { db, FieldValue } from "../config/firebase-admin";
import { isLegacyUnpaidStarterRow } from "../utils/subscription-plan-codes";

async function resolveFreePlan(): Promise<{ planId: string; planName: string }> {
  const byCode = await db
    .collection("subscription_plans")
    .where("code", "==", "free")
    .limit(1)
    .get();
  if (!byCode.empty) {
    const doc = byCode.docs[0];
    const name = String(doc.data().name || "Free");
    return { planId: doc.id, planName: name };
  }
  const byId = await db.collection("subscription_plans").doc("free").get();
  if (byId.exists) {
    return { planId: byId.id, planName: String(byId.data()?.name || "Free") };
  }
  return { planId: "free", planName: "Free" };
}

async function main() {
  const free = await resolveFreePlan();
  const payload = {
    planCode: "free",
    planName: free.planName,
    planId: free.planId,
    price: 0,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const businesses = await db.collection("businesses").select().get();
  let updated = 0;
  for (const business of businesses.docs) {
    const snap = await business.ref.collection("subscriptions").get();
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      if (!isLegacyUnpaidStarterRow(doc.data())) continue;
      batch.update(doc.ref, payload);
      updated += 1;
      ops += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }

  console.log(
    `Migrated ${updated} unpaid Starter subscription(s) across ${businesses.size} businesses to ${free.planId}.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
