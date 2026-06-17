import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// --- Mocks ---

const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    count: vi.fn(),
    get: vi.fn(),
  };
  mc.doc.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      exists: true,
      id: "test-id",
      data: () => ({
        name: "Test Biz",
        userId: "user123",
        ownerId: "user123",
        bankName: "Test Bank",
      }),
    }),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    collection: vi.fn(() => mc),
  });
  mc.add.mockResolvedValue({ id: "mock-id" });
  mc.where.mockReturnThis();
  mc.orderBy.mockReturnThis();
  mc.limit.mockReturnThis();
  mc.offset.mockReturnThis();
  mc.count.mockReturnValue({
    get: vi.fn().mockResolvedValue({ data: () => ({ count: 100 }) }),
  });
  mc.get.mockResolvedValue({
    empty: false,
    docs: [
      {
        id: "test-id",
        ref: {
          parent: { parent: { id: "parent-id" } },
          collection: vi.fn(() => mc),
          set: vi.fn().mockResolvedValue({}),
        },
        data: () => ({
          name: "Test Biz",
          title: "Test Notification",
          userId: "user123",
          bankName: "Test Bank",
          role: "owner",
          billingCycle: "monthly",
          status: "active",
          code: "scale",
          pricing: { monthly: 49, yearly: 490 },
          dates: {
            activatedAt: { toDate: () => new Date() },
            expiresAt: { toDate: () => new Date(Date.now() + 864000000) },
            gracePeriodExpiresAt: {
              toDate: () => new Date(Date.now() + 864000000 + 604800000),
            },
          },
        }),
      },
    ],
  });
  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
    collectionGroup: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        empty: false,
        docs: [
          {
            id: "user123",
            data: () => ({ role: "owner" }),
            ref: {
              parent: {
                parent: {
                  id: "test-id",
                  get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ name: "Test Biz" }),
                  }),
                },
              },
            },
          },
        ],
      }),
    })),
    batch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue({}),
    })),
    runTransaction: vi.fn(async (callback) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: false,
          data: () => ({}),
        }),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      return callback(tx);
    }),
  },
  auth: {
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "user123", email: "test@test.com" }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
  Timestamp: {
    fromDate: vi.fn((d) => d),
  },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com", name: "Test User" };
    next();
  }),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/notifications/notification-service", () => ({
  NotificationService: {
    send: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../utils/verification", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({}),
}));

// --- Test Imports ---
import { app } from "../../index";
import { db } from "../../config/firebase-admin";
import { sendVerificationEmail } from "../../utils/verification";

describe("SmartRefill V3 API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("should return 200 ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("POST /auth/signup", () => {
    it("should initialize user doc and send email", async () => {
      const res = await request(app)
        .post("/auth/signup")
        .set("Authorization", "Bearer mock-token")
        .send({ baseUrl: "http://localhost:3000" });

      expect(res.status).toBe(201);
      expect(sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe("POST /business/create", () => {
    it("should create business and owner member", async () => {
      // Mock db.collection("users").doc(uid).get() and db.collection("businesses").where().get()
      mockCollection.doc().get.mockResolvedValueOnce({ exists: true, data: () => ({}) });
      mockCollection.get.mockResolvedValueOnce({ empty: true, docs: [] });

      const res = await request(app)
        .post("/business/create")
        .send({ name: "Test Biz", email: "biz@test.com" });

      expect(res.status).toBe(201);
      expect(db.batch).toHaveBeenCalled();
    });
  });

  describe("GET /business", () => {
    it("should list businesses for user", async () => {
      const res = await request(app).get("/business");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("GET /notifications", () => {
    it("should list business notifications", async () => {
      const res = await request(app).get("/notifications?businessId=test-id");
      expect(res.status).toBe(200);
      expect(res.body.data[0].title).toBe("Test Notification");
    });
  });

  describe("PUT /notifications/read", () => {
    it("should mark notifications as read", async () => {
      const res = await request(app)
        .put("/notifications/read")
        .send({ notificationIds: ["id1", "id2"], businessId: "test-id" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(db.batch).toHaveBeenCalled();
    });
  });

  describe("GET /audit/business/:businessId", () => {
    it("should list business audit logs", async () => {
      const res = await request(app).get("/audit/business/test-id");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe("PUT /auth/account", () => {
    it("should update user account details", async () => {
      const res = await request(app)
        .put("/auth/account")
        .send({ displayName: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should update phone and sync workspace member profile", async () => {
      const res = await request(app)
        .put("/auth/account")
        .send({ displayName: "Admin User", phone: "+639171234567" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /auth/workspace-profile", () => {
    it("should return workspace member profile", async () => {
      const res = await request(app).get("/auth/workspace-profile");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.displayName).toBeDefined();
    });
  });

  describe("PATCH /business/:businessId/ui-config", () => {
    it("should update business ui configuration", async () => {
      const res = await request(app)
        .patch("/business/test-id/ui-config")
        .send({ uiConfig: { theme: "dark" } });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Payment Info Management", () => {
    let createdPaymentId = "pay1";

    it("should list payment info", async () => {
      const res = await request(app).get("/business/payment-info/test-id");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("should add payment info", async () => {
      const res = await request(app)
        .post("/business/payment-info/test-id")
        .send({
          bankName: "Test Bank",
          accountNumber: "123456",
          isPrimary: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      createdPaymentId = res.body.paymentId;
    });

    it("should update payment info", async () => {
      const res = await request(app)
        .put(`/business/payment-info/test-id/${createdPaymentId}`)
        .send({ isPrimary: false, bankName: "Updated Bank" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should delete payment info", async () => {
      const res = await request(app)
        .delete("/business/payment-info/test-id")
        .send({ paymentIds: [createdPaymentId] });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Subscription Management", () => {
    it("should list subscription plans", async () => {
      const res = await request(app).get("/subscriptions/plans");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("should get status", async () => {
      const res = await request(app).get("/subscriptions/test-id/status");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it("should list history", async () => {
      const res = await request(app).get("/subscriptions/test-id/history");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("should upgrade subscription", async () => {
      const res = await request(app)
        .post("/subscriptions/test-id/upgrade")
        .send({
          targetPlanCode: "scale",
          paymentDetails: {
            voucherCode: "SAVE50",
            paymentMethod: "gcash",
            paymentReference: "PAY-123",
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should renew subscription with payment details", async () => {
      const res = await request(app)
        .post("/subscriptions/test-id/renew")
        .send({
          paymentDetails: {
            paymentMethod: "maya",
            paymentReference: "PAY-456",
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
