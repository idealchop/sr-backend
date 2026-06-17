import { afterEach, describe, expect, it } from "vitest";
import { resolveFirebaseAdminCredentialMode } from "../../../config/firebase-admin-options";

describe("resolveFirebaseAdminCredentialMode", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("prefers SmartRefill service account env for local dev (not WFDC ADC)", () => {
    const mode = resolveFirebaseAdminCredentialMode({
      SMARTREFILL_FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@test.iam.gserviceaccount.com",
      SMARTREFILL_FIREBASE_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    });

    expect(mode).toBe("smartrefill-service-account");
  });

  it("uses emulator mode when FUNCTIONS_EMULATOR is set", () => {
    const mode = resolveFirebaseAdminCredentialMode({
      FUNCTIONS_EMULATOR: "true",
      SMARTREFILL_FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@test.iam.gserviceaccount.com",
      SMARTREFILL_FIREBASE_PRIVATE_KEY: "key",
    });

    expect(mode).toBe("emulator");
  });

  it("falls back to application-default when service account env is missing", () => {
    const mode = resolveFirebaseAdminCredentialMode({});

    expect(mode).toBe("application-default");
  });
});
