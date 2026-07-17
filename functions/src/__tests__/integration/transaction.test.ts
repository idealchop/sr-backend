import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-tx-id" }),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };

  const createDocMock = (id: string, data: any, exists = true) => ({
    id,
    get: vi.fn().mockResolvedValue({
      exists,
      id,
      data: () => data,
      ref: { update: mc.update, set: mc.set, delete: mc.delete },
    }),
    set: mc.set,
    update: mc.update,
    delete: mc.delete,
    ref: { update: mc.update, set: mc.set, delete: mc.delete },
    collection: vi.fn(() => mc),
  });

  mc.doc.mockImplementation((id?: string) => {
    if (id === "test-tx-id") {
      return createDocMock("test-tx-id", {
        totalAmount: 100,
        amountPaid: 0,
        balanceDue: 100,
        paymentStatus: "unpaid",
        deliveryStatus: "pending",
        customerId: "test-cust-id",
        referenceId: "REF-123",
      });
    }
    if (id === "item-123") {
      return createDocMock("item-123", {
        name: "Round Container",
        stock: { current: 10, min: 2 },
      });
    }
    if (id === undefined) {
      return createDocMock("new-tx-id", {}, false);
    }
    return createDocMock(id, { ownerId: "user123" });
  });

  mc.where.mockReturnThis();
  mc.orderBy.mockReturnThis();
  mc.limit.mockReturnThis();
  mc.get.mockResolvedValue({
    docs: [
      {
        id: "test-tx-id",
        data: () => ({
          totalAmount: 100,
          amountPaid: 0,
          customerId: "test-cust-id",
        }),
        ref: { update: mc.update },
      },
    ],
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
  },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com" };
    next();
  }),
}));

vi.mock("../../services/inventory/inventory-service", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    InventoryService: {
      ...actual.InventoryService,
      adjustStock: vi.fn().mockResolvedValue(100),
      adjustStockWithTransaction: vi.fn().mockResolvedValue(undefined),
      applyStockDeltasInTransaction: vi.fn().mockResolvedValue([]),
      checkLowStockAndNotify: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((msg, err) => {
      console.error(`LOGGER ERROR: ${msg}`, err);
    }),
  },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/notifications/notification-service", () => ({
  NotificationService: {
    broadcastToBusiness: vi.fn().mockResolvedValue({}),
    send: vi.fn().mockResolvedValue({}),
  },
}));

describe("Transaction API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/transactions", () => {
    it("should list transactions for a business", async () => {
      const res = await request(app).get("/business/test-biz/transactions");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /business/:businessId/transactions", () => {
    it("should create a new transaction and update customer hasBalance flag", async () => {
      // hasBalance only flips for fulfilled unpaid/partial receivables
      // (pending deliveries are not debt yet).
      const res = await request(app)
        .post("/business/test-biz/transactions")
        .send({
          customerId: "test-cust-id",
          totalAmount: 200,
          amountPaid: 50,
          type: "delivery",
          deliveryStatus: "completed",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("new-tx-id");

      // Verify customer update was called
      expect(mockCollection.doc).toHaveBeenCalledWith("test-cust-id");
      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          hasBalance: true,
        }),
      );
    });

    it("should create a new transaction with signatureUrl", async () => {
      const signatureUrl = "https://storage.google.com/signatures/new.png";
      const res = await request(app)
        .post("/business/test-biz/transactions")
        .send({
          customerId: "test-cust-id",
          totalAmount: 200,
          amountPaid: 200,
          type: "delivery",
          signatureUrl,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.signatureUrl).toBe(signatureUrl);
    });

    it("should create a direct_sale with ledger-only manual and adjustment lines", async () => {
      const res = await request(app)
        .post("/business/test-biz/transactions")
        .send({
          type: "direct_sale",
          totalAmount: 1600,
          amountPaid: 1600,
          deliveryStatus: "completed",
          items: [
            {
              inventoryId: "item-123",
              name: "Dispenser",
              quantity: 1,
              unitPrice: 1500,
              subtotal: 1500,
            },
            {
              inventoryId: "manual_item",
              name: "Custom fee",
              quantity: 1,
              unitPrice: 50,
              subtotal: 50,
            },
            {
              inventoryId: "adjustment",
              name: "Adjustment",
              quantity: 1,
              unitPrice: 50,
              subtotal: 50,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe("direct_sale");
      expect(res.body.data.items).toHaveLength(3);
    });

    it("should create a new collection transaction with inventory adjustments", async () => {
      const res = await request(app)
        .post("/business/test-biz/transactions")
        .send({
          customerId: "test-cust-id",
          type: "collection",
          collectionItems: [
            {
              inventoryId: "item-123",
              name: "Round Container",
              qtyExpected: 5,
              qtyCollected: 5,
              status: "completed",
            },
          ],
          totalAmount: 0,
          amountPaid: 0,
          paymentStatus: "paid",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe("collection");
      expect(res.body.data.collectionItems).toHaveLength(1);
    });
  });

  describe("PATCH /business/:businessId/transactions/:id", () => {
    it("should update a transaction and sync customer hasBalance flag", async () => {
      // Mock search for unpaid transactions to return empty
      mockCollection.get.mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

      const res = await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ amountPaid: 100 }); // Total was 100 in mock

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify customer update was called to clear hasBalance
      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          hasBalance: false,
        }),
      );
    });

    it("should allow updating the signatureUrl", async () => {
      const signatureUrl = "https://storage.google.com/signatures/patched.png";
      const res = await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ signatureUrl });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          signatureUrl: signatureUrl,
        }),
      );
    });

    it("should sync with delivery when deliveryStatus is updated", async () => {
      const transactionId = "test-tx-id";
      const deliveryId = "test-delivery-id";
      // Mock finding the delivery
      const mockUpdate = vi.fn().mockResolvedValue({});
      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: deliveryId,
            ref: {
              update: mockUpdate,
            },
          },
        ],
      });

      const res = await request(app)
        .patch(`/business/test-biz/transactions/${transactionId}`)
        .send({ deliveryStatus: "collected" });

      expect(res.status).toBe(200);
      expect(mockCollection.where).toHaveBeenCalledWith(
        "transactionId",
        "==",
        transactionId,
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "collected",
        }),
      );
    });

    it("should log TRANSACTION_UPDATED when core fields are modified", async () => {
      const { logAuditEvent } =
        await import("../../services/observability/logging/logger");

      await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ notes: "Updated notes", totalAmount: 150 });

      expect(logAuditEvent).toHaveBeenCalledWith(
        "TRANSACTION_UPDATED",
        expect.objectContaining({ businessId: "test-biz" }),
        null,
        expect.objectContaining({ notes: "Updated notes", totalAmount: 150 }),
        "test-tx-id",
        expect.arrayContaining(["notes", "totalAmount"]),
      );
    });

    it("should log TRANSACTION_UPDATED when balanceDue changes", async () => {
      const { logAuditEvent } =
        await import("../../services/observability/logging/logger");

      await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ totalAmount: 150 });

      expect(logAuditEvent).toHaveBeenCalledWith(
        "TRANSACTION_UPDATED",
        expect.objectContaining({ businessId: "test-biz" }),
        null,
        expect.objectContaining({ totalAmount: 150, balanceDue: 150 }),
        "test-tx-id",
        expect.arrayContaining(["totalAmount", "balanceDue"]),
      );
    });

    it("should log STATUS_CHANGED when deliveryStatus changes", async () => {
      const { logAuditEvent } =
        await import("../../services/observability/logging/logger");

      await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ deliveryStatus: "delivered" });

      expect(logAuditEvent).toHaveBeenCalledWith(
        "STATUS_CHANGED",
        expect.objectContaining({ field: "deliveryStatus" }),
        "pending", // current status in mock
        "delivered",
        "test-tx-id",
      );
    });

    it("should set arrivedAt on first transition to in-transit", async () => {
      mockCollection.get.mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

      await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ deliveryStatus: "in-transit" });

      expect(mockCollection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: "in-transit",
          arrivedAt: "mock-timestamp",
        }),
      );
    });

    it("should log PAYMENT_STATUS_CHANGED when payment status changes", async () => {
      const { logAuditEvent } =
        await import("../../services/observability/logging/logger");

      await request(app)
        .patch("/business/test-biz/transactions/test-tx-id")
        .send({ amountPaid: 100 }); // total is 100 in mock, so it becomes 'paid'

      expect(logAuditEvent).toHaveBeenCalledWith(
        "PAYMENT_STATUS_CHANGED",
        expect.objectContaining({ field: "paymentStatus" }),
        "unpaid",
        "paid",
        "test-tx-id",
      );
    });
  });

  describe("GET /business/:businessId/transactions/:id/history", () => {
    it("should fetch transaction history with correct where clause", async () => {
      const transactionId = "test-tx-id";

      const res = await request(app).get(
        `/business/test-biz/transactions/${transactionId}/history`,
      );

      expect(res.status).toBe(200);
      expect(mockCollection.where).toHaveBeenCalledWith(
        "transactionId",
        "==",
        transactionId,
      );
    });
  });
});
