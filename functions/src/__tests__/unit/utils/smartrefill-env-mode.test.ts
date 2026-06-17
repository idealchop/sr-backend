import { afterEach, describe, expect, it } from "vitest";
import {
  assertSmartrefillDevNotEnabledInProd,
  isDeployedCloudRuntime,
  isSmartrefillDevMode,
} from "../../../utils/smartrefill-env-mode";

describe("smartrefill-env-mode", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("treats SMARTREFILL_ENV_DEV=true as dev mode locally", () => {
    process.env.SMARTREFILL_ENV_DEV = "true";
    delete process.env.K_SERVICE;
    delete process.env.FUNCTION_TARGET;
    expect(isSmartrefillDevMode()).toBe(true);
  });

  it("throws when dev mode is enabled on deployed Cloud Run", () => {
    process.env.SMARTREFILL_ENV_DEV = "true";
    process.env.K_SERVICE = "smartrefillv3api";
    delete process.env.FUNCTIONS_EMULATOR;
    expect(() => assertSmartrefillDevNotEnabledInProd("Brevo")).toThrow(
      /SMARTREFILL_ENV_DEV must not be true on deployed Cloud Functions/,
    );
  });

  it("does not treat emulator as deployed Cloud Run", () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.K_SERVICE = "smartrefillv3api";
    expect(isDeployedCloudRuntime()).toBe(false);
  });
});
