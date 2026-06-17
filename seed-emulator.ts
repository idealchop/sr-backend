import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

admin.initializeApp({
    projectId: "aquaflow-management-suite",
});

const db = admin.firestore();

async function seed() {
    console.log("Seeding emulator...");

    const businessId = "test-id";
    const userId = "user123";

    // Create test business
    await db.collection("businesses").doc(businessId).set({
        name: "Test Business",
        email: "test@business.com",
        ownerId: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add user as member
    await db.collection("businesses").doc(businessId).collection("members").doc(userId).set({
        userId: userId,
        email: "test@test.com",
        name: "BDD Tester",
        role: "owner",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Seeded business ${businessId} for user ${userId}`);
    process.exit(0);
}

seed().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
