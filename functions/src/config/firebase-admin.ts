import { loadLocalEnvIfNeeded } from "./load-local-env";
loadLocalEnvIfNeeded();

import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { buildFirebaseAdminInit } from "./firebase-admin-options";

let app: admin.app.App;
if (admin.apps.length === 0) {
  const { projectId, credentialMode, options } = buildFirebaseAdminInit();
  app = admin.initializeApp(options);
  logger.info("Firebase Admin SDK initialized for SmartRefill V3", {
    projectId: app.options.projectId ?? projectId,
    credentialMode,
    firestoreDatabaseId: process.env.SMARTREFILL_FIRESTORE_DB || "riverdb",
  });
} else {
  app = admin.app();
}

const firestoreDatabaseId = process.env.SMARTREFILL_FIRESTORE_DB || "riverdb";
export const db = getFirestore(app, firestoreDatabaseId);

db.settings({ ignoreUndefinedProperties: true });
export const auth = admin.auth(app);
export const storage = admin.storage(app);
export const appCheck = admin.appCheck(app);

export { FieldValue, Timestamp } from "firebase-admin/firestore";
