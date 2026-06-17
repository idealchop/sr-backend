import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const userDocGet = vi.fn();
const userDocSet = vi.fn();
const userDocUpdate = vi.fn();

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = {
      uid: "user-abc",
      email: "owner@test.com",
      name: "Test Owner",
    };
    next();
  }),
}));

vi.mock("../../utils/verification", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendForgotPasswordEmail: vi.fn(),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: userDocGet,
        set: userDocSet,
        update: userDocUpdate,
      })),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
  auth: {
    getUser: vi.fn().mockResolvedValue({
      uid: "user-abc",
      email: "owner@test.com",
      displayName: "Test Owner",
      photoURL: "",
    }),
  },
}));

import { app } from "../../index";

describe("POST /auth/signup appAccess rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new user document when none exists", async () => {
    userDocGet.mockResolvedValue({ exists: false });

    const res = await request(app)
      .post("/auth/signup")
      .set("Authorization", "Bearer mock-token")
      .send({ fullName: "New Owner", baseUrl: "http://localhost:3000" });

    expect(res.status).toBe(201);
    expect(userDocSet).toHaveBeenCalled();
    expect(userDocUpdate).not.toHaveBeenCalled();
  });

  it("grants smartrefill when user exists without appAccess entry", async () => {
    userDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        email: "owner@test.com",
        appAccess: [{ appId: "legacy-app", role: "user" }],
      }),
    });

    const res = await request(app)
      .post("/auth/signup")
      .set("Authorization", "Bearer mock-token")
      .send({ fullName: "Cross App User", baseUrl: "http://localhost:3000" });

    expect(res.status).toBe(201);
    expect(userDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "user-abc",
        email: "owner@test.com",
        displayName: expect.any(String),
        appAccess: expect.any(Array),
        updatedAt: "SERVER_TS",
      }),
      { merge: true },
    );
    expect(userDocUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when smartrefill appAccess already exists", async () => {
    userDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        email: "owner@test.com",
        appAccess: [{ appId: "smartrefill", role: "owner" }],
      }),
    });

    const res = await request(app)
      .post("/auth/signup")
      .set("Authorization", "Bearer mock-token")
      .send({ baseUrl: "http://localhost:3000" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(userDocUpdate).not.toHaveBeenCalled();
    expect(userDocSet).not.toHaveBeenCalled();
  });
});
