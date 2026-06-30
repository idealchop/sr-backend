import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
import { buildMetaWebhookSignature } from "../../services/meta/meta-community-webhook-signature";

vi.mock("../../services/meta/meta-community-webhook-processor", () => ({
  processMetaCommunityWebhook: vi.fn().mockResolvedValue(undefined),
}));

describe("community meta webhook (integration)", () => {
  const originalVerify = process.env.META_COMMUNITY_VERIFY_TOKEN;
  const originalSecret = process.env.META_COMMUNITY_APP_SECRET;
  const originalDev = process.env.SMARTREFILL_ENV_DEV;

  beforeEach(() => {
    process.env.META_COMMUNITY_VERIFY_TOKEN = "verify-integration-test";
    process.env.SMARTREFILL_ENV_DEV = "true";
    delete process.env.META_COMMUNITY_APP_SECRET;
  });

  afterEach(() => {
    if (originalVerify === undefined) delete process.env.META_COMMUNITY_VERIFY_TOKEN;
    else process.env.META_COMMUNITY_VERIFY_TOKEN = originalVerify;
    if (originalSecret === undefined) delete process.env.META_COMMUNITY_APP_SECRET;
    else process.env.META_COMMUNITY_APP_SECRET = originalSecret;
    if (originalDev === undefined) delete process.env.SMARTREFILL_ENV_DEV;
    else process.env.SMARTREFILL_ENV_DEV = originalDev;
  });

  it("GET echoes hub.challenge when verify token matches", async () => {
    const res = await request(app)
      .get("/public/webhooks/meta/community")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-integration-test",
        "hub.challenge": "challenge-123",
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge-123");
  });

  it("POST accepts unsigned body in local dev when app secret is unset", async () => {
    const body = { object: "page", entry: [] };
    const res = await request(app)
      .post("/public/webhooks/meta/community")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.text).toBe("EVENT_RECEIVED");
  });

  it("POST rejects invalid signature when app secret is configured", async () => {
    process.env.META_COMMUNITY_APP_SECRET = "integration-app-secret";
    const body = { object: "page", entry: [] };

    const res = await request(app)
      .post("/public/webhooks/meta/community")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(body);

    expect(res.status).toBe(403);
    expect(res.text).toBe("Forbidden");
  });

  it("POST accepts valid X-Hub-Signature-256 when app secret is configured", async () => {
    process.env.META_COMMUNITY_APP_SECRET = "integration-app-secret";
    const body = { object: "page", entry: [] };
    const rawBody = JSON.stringify(body);
    const signature = buildMetaWebhookSignature(rawBody, "integration-app-secret");

    const res = await request(app)
      .post("/public/webhooks/meta/community")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.text).toBe("EVENT_RECEIVED");
  });
});
