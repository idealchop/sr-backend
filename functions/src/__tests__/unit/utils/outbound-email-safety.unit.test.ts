import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDevOutboundEmailRedirect,
  resolveDevEmailSink,
  shouldRedirectOutboundEmail,
} from "../../../utils/outbound-email-safety";

describe("outbound-email-safety", () => {
  const prev = {
    SMARTREFILL_ENV_DEV: process.env.SMARTREFILL_ENV_DEV,
    SMARTREFILL_DEPLOY_TIER: process.env.SMARTREFILL_DEPLOY_TIER,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    SMARTREFILL_EMAIL_SINK: process.env.SMARTREFILL_EMAIL_SINK,
    K_SERVICE: process.env.K_SERVICE,
  };

  beforeEach(() => {
    delete process.env.SMARTREFILL_ENV_DEV;
    delete process.env.SMARTREFILL_DEPLOY_TIER;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.SUPPORT_EMAIL;
    delete process.env.SMARTREFILL_EMAIL_SINK;
    delete process.env.K_SERVICE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("does not redirect in production-like env", () => {
    expect(shouldRedirectOutboundEmail()).toBe(false);
    const payload = {
      to: [{ email: "customer@example.com", name: "Cust" }],
      subject: "Receipt",
    };
    const result = applyDevOutboundEmailRedirect(payload);
    expect(result.redirected).toBe(false);
    expect(payload.to?.[0]?.email).toBe("customer@example.com");
    expect(payload.subject).toBe("Receipt");
  });

  it("redirects all recipients to support@riverph.com when SMARTREFILL_ENV_DEV", () => {
    process.env.SMARTREFILL_ENV_DEV = "true";
    expect(resolveDevEmailSink()).toBe("support@riverph.com");

    const payload = {
      to: [{ email: "customer@example.com", name: "Cust" }],
      cc: [{ email: "owner@station.com", name: "Owner" }],
      bcc: [{ email: "hidden@example.com" }],
      subject: "Your receipt TX-1",
    };
    const result = applyDevOutboundEmailRedirect(payload);
    expect(result.redirected).toBe(true);
    expect(result.sink).toBe("support@riverph.com");
    expect(payload.to).toEqual([
      { email: "support@riverph.com", name: "Smart Refill Dev" },
    ]);
    expect(payload.cc).toBeUndefined();
    expect(payload.bcc).toBeUndefined();
    expect(payload.subject).toBe(
      "[DEV → customer@example.com, owner@station.com, hidden@example.com] Your receipt TX-1",
    );
  });

  it("redirects on deployed Dev tier", () => {
    process.env.SMARTREFILL_DEPLOY_TIER = "dev";
    const payload = {
      to: [{ email: "suki@example.com" }],
      subject: "Order update",
    };
    const result = applyDevOutboundEmailRedirect(payload);
    expect(result.redirected).toBe(true);
    expect(payload.to?.[0]?.email).toBe("support@riverph.com");
  });

  it("honors SUPPORT_EMAIL override", () => {
    process.env.SMARTREFILL_ENV_DEV = "true";
    process.env.SUPPORT_EMAIL = "Support@RiverPH.com";
    expect(resolveDevEmailSink()).toBe("support@riverph.com");
  });
});
