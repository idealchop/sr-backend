import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  assertMetaCommunityWebhookAuthentic,
  buildMetaWebhookSignature,
  verifyMetaCommunityWebhookSignature,
} from "../../../../services/meta/meta-community-webhook-signature";

describe("meta-community-webhook-signature", () => {
  const originalSecret = process.env.META_COMMUNITY_APP_SECRET;
  const originalDev = process.env.SMARTREFILL_ENV_DEV;
  const originalEmulator = process.env.FUNCTIONS_EMULATOR;
  const originalKService = process.env.K_SERVICE;

  beforeEach(() => {
    delete process.env.META_COMMUNITY_APP_SECRET;
    process.env.SMARTREFILL_ENV_DEV = "true";
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.K_SERVICE;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.META_COMMUNITY_APP_SECRET;
    else process.env.META_COMMUNITY_APP_SECRET = originalSecret;

    if (originalDev === undefined) delete process.env.SMARTREFILL_ENV_DEV;
    else process.env.SMARTREFILL_ENV_DEV = originalDev;

    if (originalEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = originalEmulator;

    if (originalKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalKService;
  });

  it("builds and verifies sha256 signature", () => {
    const rawBody = Buffer.from("{\"object\":\"page\"}", "utf8");
    const signature = buildMetaWebhookSignature(rawBody, "test-app-secret");

    expect(
      verifyMetaCommunityWebhookSignature({
        rawBody,
        signatureHeader: signature,
        appSecret: "test-app-secret",
      }),
    ).toBe(true);
  });

  it("rejects tampered payload", () => {
    const rawBody = Buffer.from("{\"object\":\"page\"}", "utf8");
    const signature = buildMetaWebhookSignature(rawBody, "test-app-secret");

    expect(
      verifyMetaCommunityWebhookSignature({
        rawBody: Buffer.from("{\"object\":\"instagram\"}", "utf8"),
        signatureHeader: signature,
        appSecret: "test-app-secret",
      }),
    ).toBe(false);
  });

  it("skips verification in dev when app secret is unset", () => {
    const result = assertMetaCommunityWebhookAuthentic({
      body: { object: "page" },
      get: () => undefined,
    } as never);

    expect(result).toEqual({ ok: true });
  });

  it("requires valid signature when app secret is configured", () => {
    process.env.META_COMMUNITY_APP_SECRET = "test-app-secret";
    const rawBody = Buffer.from("{\"object\":\"page\",\"entry\":[]}", "utf8");
    const signature = buildMetaWebhookSignature(rawBody, "test-app-secret");

    expect(
      assertMetaCommunityWebhookAuthentic({
        rawBody,
        body: JSON.parse(rawBody.toString("utf8")),
        get: (name: string) => (name.toLowerCase() === "x-hub-signature-256" ? signature : undefined),
      } as never),
    ).toEqual({ ok: true });
  });

  it("rejects POST when signature is missing and secret is configured", () => {
    process.env.META_COMMUNITY_APP_SECRET = "test-app-secret";
    const rawBody = Buffer.from("{}", "utf8");

    expect(
      assertMetaCommunityWebhookAuthentic({
        rawBody,
        body: {},
        get: () => undefined,
      } as never),
    ).toEqual({ ok: false, status: 403, reason: "invalid_signature" });
  });

  it("returns 503 in production when app secret is missing", () => {
    delete process.env.SMARTREFILL_ENV_DEV;
    process.env.K_SERVICE = "smartrefillV3Api";

    expect(
      assertMetaCommunityWebhookAuthentic({
        rawBody: Buffer.from("{}"),
        body: {},
        get: () => undefined,
      } as never),
    ).toEqual({ ok: false, status: 503, reason: "webhook_not_configured" });
  });

  it("matches Meta sample HMAC construction", () => {
    const secret = "my-secret";
    const payload = Buffer.from("hello world", "utf8");
    const expected =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

    expect(buildMetaWebhookSignature(payload, secret)).toBe(expected);
  });
});
