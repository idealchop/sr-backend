import * as admin from "firebase-admin";

const SMARTREFILL_PROJECT_ID =
  process.env.SMARTREFILL_FIREBASE_PROJECT_ID || "aquaflow-management-suite";

export type FirebaseAdminCredentialMode =
  | "emulator"
  | "smartrefill-service-account"
  | "application-default";

export interface FirebaseAdminInitMeta {
  projectId: string;
  credentialMode: FirebaseAdminCredentialMode;
  options: admin.AppOptions;
}

function normalizePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/\\n/g, "\n");
}

export function resolveFirebaseAdminCredentialMode(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseAdminCredentialMode {
  if (env.FUNCTIONS_EMULATOR) return "emulator";
  if (env.SMARTREFILL_FIREBASE_CLIENT_EMAIL && env.SMARTREFILL_FIREBASE_PRIVATE_KEY) {
    return "smartrefill-service-account";
  }
  return "application-default";
}

/**
 * SmartRefill V3 must verify ID tokens from `aquaflow-management-suite` (client SDK).
 * Local `serve:local` must use SMARTREFILL_* service account env vars — not WFDC ADC.
 * @return {FirebaseAdminInitMeta} Firebase Admin initialization metadata and app options.
 */
export function buildFirebaseAdminInit(): FirebaseAdminInitMeta {
  const storageBucket = process.env.SMARTREFILL_FIREBASE_STORAGE_BUCKET;
  const credentialMode = resolveFirebaseAdminCredentialMode();

  if (credentialMode === "emulator") {
    return {
      projectId: SMARTREFILL_PROJECT_ID,
      credentialMode,
      options: {
        projectId: SMARTREFILL_PROJECT_ID,
        storageBucket: storageBucket || `${SMARTREFILL_PROJECT_ID}.appspot.com`,
      },
    };
  }

  const clientEmail = process.env.SMARTREFILL_FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.SMARTREFILL_FIREBASE_PRIVATE_KEY);

  if (credentialMode === "smartrefill-service-account" && clientEmail && privateKey) {
    return {
      projectId: SMARTREFILL_PROJECT_ID,
      credentialMode,
      options: {
        projectId: SMARTREFILL_PROJECT_ID,
        ...(storageBucket ? { storageBucket } : {}),
        credential: admin.credential.cert({
          projectId: SMARTREFILL_PROJECT_ID,
          clientEmail,
          privateKey,
        }),
      },
    };
  }

  return {
    projectId: SMARTREFILL_PROJECT_ID,
    credentialMode,
    options: {
      ...(storageBucket ? { storageBucket } : {}),
    },
  };
}
