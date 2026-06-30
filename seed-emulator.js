const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = admin.initializeApp({
    projectId: "aquaflow-management-suite",
});

const targetDb = "riverdb";
const firestore = getFirestore(app, targetDb);

async function seed() {
    console.log(`Seeding emulator (db: ${targetDb})...`);

    const businessId = "test-id";
    const bizTestId = "biz_test_123";
    const userId = "user123";

    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 7);
    // Trial has no post-expiry grace (see subscription-lifecycle.md).
    const gracePeriodExpiry = new Date(trialExpiry);

    // Create test businesses
    const businesses = [businessId, bizTestId];
    for (const id of businesses) {
        await firestore.collection("businesses").doc(id).set({
            name: `Test Business ${id}`,
            email: "test@business.com",
            ownerId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(id === businessId ?
                {
                    location: { lat: 14.42, lng: 121.04 },
                    communityDispatch: {
                        enabled: true,
                        acceptingOrders: true,
                        publicName: "Water Ko To Test",
                        slug: "water-ko-to-test",
                    },
                } :
                {}),
        }, { merge: true });

        // Add user as member
        await firestore.collection("businesses").doc(id).collection("members").doc(userId).set({
            userId: userId,
            email: "test@test.com",
            name: "BDD Tester",
            role: "owner",
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Trial subscription for BDD subscription lifecycle tests
        await firestore
            .collection("businesses")
            .doc(id)
            .collection("subscriptions")
            .doc("bdd-trial-sub")
            .set({
                planId: "scale",
                planCode: "scale",
                planName: "Scale Plan",
                status: "active",
                billingCycle: "trial",
                price: 0,
                dates: {
                    activatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    expiresAt: admin.firestore.Timestamp.fromDate(trialExpiry),
                    renewalAt: admin.firestore.Timestamp.fromDate(trialExpiry),
                    gracePeriodExpiresAt: admin.firestore.Timestamp.fromDate(gracePeriodExpiry),
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
    }

    // Create test customer
    const customerId = "test-customer-id";
    await firestore.collection("businesses").doc(businessId).collection("customers").doc(customerId).set({
        name: "BDD Test Customer",
        type: "residential",
        phone: "09123456789",
        address: "123 BDD St",
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Fresh signup BDD user (auth.spec.ts) — cleared each emulator seed run
    await firestore.collection("users").doc("bdd_signup_user").delete();

    console.log(`Seeded customer ${customerId} for business ${businessId}`);
    console.log(`Seeded businesses ${businesses.join(", ")} for user ${userId}`);
    process.exit(0);
}

seed().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
