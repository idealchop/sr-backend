import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { metaCommunityWebhook } from "../../../handlers/meta/meta-community-webhook-handler";
import { buildMetaWebhookSignature } from "../../../services/meta/meta-community-webhook-signature";

vi.mock("../../../services/meta/meta-community-webhook-processor", () => ({
  processMetaCommunityWebhook: vi.fn().mockResolvedValue(undefined),
}));

function mockRes() {
  const res = {
    statusCode: 200,
    body: "",
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type(ct: string) {
      this.headers["content-type"] = ct;
      return this;
    },
    send(payload: string) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  };
}

describe("metaCommunityWebhook", () => {
  const originalToken = process.env.META_COMMUNITY_VERIFY_TOKEN;
  const originalSecret = process.env.META_COMMUNITY_APP_SECRET;
  const originalDev = process.env.SMARTREFILL_ENV_DEV;

  beforeEach(() => {
    process.env.META_COMMUNITY_VERIFY_TOKEN = "river-smartrefill-verify-2026";
    process.env.SMARTREFILL_ENV_DEV = "true";
    delete process.env.META_COMMUNITY_APP_SECRET;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.META_COMMUNITY_VERIFY_TOKEN;
    } else {
      process.env.META_COMMUNITY_VERIFY_TOKEN = originalToken;
    }
    if (originalSecret === undefined) {
      delete process.env.META_COMMUNITY_APP_SECRET;
    } else {
      process.env.META_COMMUNITY_APP_SECRET = originalSecret;
    }
    if (originalDev === undefined) {
      delete process.env.SMARTREFILL_ENV_DEV;
    } else {
      process.env.SMARTREFILL_ENV_DEV = originalDev;
    }
  });

  it("echoes hub.challenge when verify token matches", async () => {
    const req = {
      method: "GET",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "river-smartrefill-verify-2026",
        "hub.challenge": "challenge-abc",
      },
    } as unknown as Request;
    const res = mockRes();

    await metaCommunityWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("challenge-abc");
  });

  it("rejects invalid verify token", async () => {
    const req = {
      method: "GET",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "challenge-abc",
      },
    } as unknown as Request;
    const res = mockRes();

    await metaCommunityWebhook(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("acks POST events when signature not enforced (local dev)", async () => {
    const req = {
      method: "POST",
      body: { object: "page", entry: [] },
      rawBody: Buffer.from("{\"object\":\"page\",\"entry\":[]}", "utf8"),
      get: () => undefined,
    } as unknown as Request;
    const res = mockRes();

    await metaCommunityWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("EVENT_RECEIVED");
  });

  it("rejects POST when signature is invalid and secret is configured", async () => {
    process.env.META_COMMUNITY_APP_SECRET = "test-app-secret";
    const rawBody = Buffer.from("{\"object\":\"page\",\"entry\":[]}", "utf8");
    const req = {
      method: "POST",
      body: { object: "page", entry: [] },
      rawBody,
      get: () => "sha256=deadbeef",
    } as unknown as Request;
    const res = mockRes();

    await metaCommunityWebhook(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe("Forbidden");
  });

  it("acks POST when signature matches app secret", async () => {
    process.env.META_COMMUNITY_APP_SECRET = "test-app-secret";
    const rawBody = Buffer.from("{\"object\":\"page\",\"entry\":[]}", "utf8");
    const signature = buildMetaWebhookSignature(rawBody, "test-app-secret");
    const req = {
      method: "POST",
      body: { object: "page", entry: [] },
      rawBody,
      get: (name: string) => (name.toLowerCase() === "x-hub-signature-256" ? signature : undefined),
    } as unknown as Request;
    const res = mockRes();

    await metaCommunityWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("EVENT_RECEIVED");
  });
});
