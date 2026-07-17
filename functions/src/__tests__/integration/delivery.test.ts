import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-delivery-id" }),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };

  const createDocMock = (id: string, data: any) => {
    const docRef = {
      id,
      set: mc.set,
      update: mc.update,
      delete: mc.delete,
      collection: vi.fn(() => mc),
      get: vi.fn(),
    };
    (docRef.get as any).mockResolvedValue({
      exists: true,
      id,
      data: () => data,
      ref: docRef,
    });
    return docRef;
  };

  mc.doc.mockImplementation((id?: string) => {
    if (id === "test-delivery-id") {
      return createDocMock("test-delivery-id", {
        status: "pending",
        transactionId: "test-tx-id",
        businessId: "test-biz",
      });
    }
    if (id === "test-tx-id") {
      return createDocMock("test-tx-id", {
        type: "delivery",
        deliveryStatus: "pending",
        riderId: "rider-1",
        riderName: "Test Rider",
        totalAmount: 100,
        amountPaid: 0,
        balanceDue: 100,
        paymentStatus: "unpaid",
        salesStockApplied: true,
      });
    }
    return createDocMock(id || "test-id", { ownerId: "user123" });
  });

  mc.where.mockReturnThis();
  mc.orderBy.mockReturnThis();
  mc.limit.mockReturnThis();
  mc.get.mockImplementation(async function(this: any) {
    const data = { status: "pending", transactionId: "test-tx-id" };
    const id = "test-delivery-id";
    const docRef = {
      id,
      update: mc.update,
      delete: mc.delete,
      collection: vi.fn(() => mc),
    };
    const docs = [
      {
        id,
        data: () => data,
        ref: docRef,
      },
    ];
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: (callback: any) => docs.forEach(callback),
    };
  });

  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
    runTransaction: vi.fn(async (cb) => {
      return await cb({
        get: vi.fn(async (ref) => await ref.get()),
        set: vi.fn((ref, data) => ref.set(data)),
        update: vi.fn((ref, data) => ref.update(data)),
        delete: vi.fn((ref) => ref.delete()),
      });
    }),
  },
  auth: {
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "user123", email: "test@test.com" }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
    delete: vi.fn(() => "mock-delete"),
  },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com" };
    next();
  }),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/notifications/notification-service", () => ({
  NotificationService: {
    broadcastToBusiness: vi.fn().mockResolvedValue({}),
    send: vi.fn().mockResolvedValue({}),
  },
}));

describe("Delivery API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/deliveries/active", () => {
    it("should list active deliveries", async () => {
      const res = await request(app).get(
        "/business/test-biz/deliveries/active",
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /business/:businessId/deliveries", () => {
    it("should create a new delivery", async () => {
      const res = await request(app)
        .post("/business/test-biz/deliveries")
        .send({ customerId: "cust-1", transactionId: "tx-1" });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe("new-delivery-id");
    });
  });

  describe("POST /business/:businessId/deliveries/:id/assign", () => {
    it("should assign a rider", async () => {
      const res = await request(app)
        .post("/business/test-biz/deliveries/test-delivery-id/assign")
        .send({ riderId: "rider-1" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /business/:businessId/deliveries/:id/complete", () => {
    it("should complete a delivery with a signature and sync with transaction", async () => {
      const signatureUrl = "https://storage.google.com/signatures/test.png";
      const res = await request(app)
        .post("/business/test-biz/deliveries/test-delivery-id/complete")
        .send({
          containerMovements: [],
          signatureUrl,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify delivery update
      expect(mockCollection.doc).toHaveBeenCalledWith("test-delivery-id");
      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "delivered",
          signatureUrl: signatureUrl,
          completedAt: "mock-timestamp",
        }),
      );

      // Verify transaction sync update
      expect(mockCollection.doc).toHaveBeenCalledWith("test-tx-id");
      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: "completed",
          signatureUrl: signatureUrl,
          deliveredAt: "mock-timestamp",
        }),
      );
    });
  });
});
