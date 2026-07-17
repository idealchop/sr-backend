import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
import { db } from "../../config/firebase-admin";

// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    get: vi.fn(),
  };
  mc.doc.mockReturnValue({
    id: "test-item-id",
    get: vi.fn().mockResolvedValue({
      exists: true,
      id: "test-item-id",
      data: () => ({
        name: "Test Item",
        stock: { current: 10, min: 2 },
        ownerId: "user123",
      }),
    }),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    collection: vi.fn(() => mc),
  });
  mc.orderBy.mockReturnThis();
  mc.get.mockResolvedValue({
    empty: false,
    docs: [
      {
        id: "test-item-id",
        data: () => ({
          name: "Test Item",
          stock: { current: 10, min: 2 },
        }),
      },
    ],
  });
  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
    runTransaction: vi.fn(async (cb) =>
      cb({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ stock: { current: 10 } }),
        }),
        update: vi.fn(),
      }),
    ),
  },
  auth: {
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "user123", email: "test@test.com" }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com" };
    next();
  }),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

describe("Inventory API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /inventory/:businessId", () => {
    it("should list inventory items for a business", async () => {
      const res = await request(app).get("/inventory/test-id");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].name).toBe("Test Item");
    });
  });

  describe("POST /inventory/:businessId", () => {
    it("should create a new inventory item", async () => {
      const res = await request(app)
        .post("/inventory/test-id")
        .send({
          name: "New Bottle",
          stock: { current: 50, min: 5 },
          cost: 100,
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.itemId).toBeDefined();
    });
  });

  describe("POST /inventory/:businessId/:itemId/adjust-stock", () => {
    it("should adjust stock atomically", async () => {
      const res = await request(app)
        .post("/inventory/test-id/test-item-id/adjust-stock")
        .send({ amount: 5 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(db.runTransaction).toHaveBeenCalled();
    });

    it("should return 400 if amount is not a number", async () => {
      const res = await request(app)
        .post("/inventory/test-id/test-item-id/adjust-stock")
        .send({ amount: "five" });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /inventory/:businessId/:itemId", () => {
    it("should update an inventory item", async () => {
      const res = await request(app)
        .patch("/inventory/test-id/test-item-id")
        .send({ name: "Updated Name" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("DELETE /inventory/:businessId/:itemId", () => {
    it("should delete an inventory item", async () => {
      const res = await request(app).delete("/inventory/test-id/test-item-id");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
