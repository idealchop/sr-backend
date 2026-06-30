import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../../index";
// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-collection-id" }),
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
        type: "delivery",
        customerId: "cust-456",
        items: [{ itemId: "item-123", quantity: 2 }],
      });
    }
    if (id === "item-123") {
      return createDocMock("item-123", {
        name: "Round Container",
        stock: { current: 10, min: 2 },
      });
    }
    if (id === undefined) {
      return createDocMock("new-collection-id", {}, false);
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
        data: () => ({ type: "delivery", customerId: "cust-456" }),
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

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/inventory/inventory-service", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    InventoryService: {
      ...actual.InventoryService,
      adjustStock: vi.fn().mockResolvedValue(100),
      checkLowStockAndNotify: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("Feature: Collection Management Flow", () => {
  const businessId = "test-biz-123";
  const customerId = "cust-456";
  const linkedTransactionId = "tx-delivery-789";
  // let collectionId = "";

  describe("Scenario: Recording a collection linked to a previous delivery", () => {
    it("Step 1: Given a completed delivery exists for a customer", async () => {
      expect(customerId).toBeDefined();
      expect(linkedTransactionId).toBeDefined();
    });

    it(
      "Step 2: When the manager records a collection for the containers from that delivery",
      async () => {
        const res = await request(app)
          .post(`/business/${businessId}/transactions`)
          .send({
            type: "collection",
            customerId,
            customerName: "Test Customer",
            linkedTransactionId,
            collectionItems: [
              {
                inventoryId: "item-123",
                name: "Round Container",
                qtyExpected: 2,
                qtyCollected: 2,
                status: "ok",
              },
            ],
            totalAmount: 0,
            amountPaid: 0,
            paymentStatus: "paid",
            deliveryStatus: "completed",
          });

        expect(res.status).toBe(201);
        expect(res.body.data.id).toBeDefined();
        // collectionId = res.body.data.id;
        expect(res.body.data.type).toBe("collection");
      },
    );

    it("Step 3: Then the manager can see the collection in the transaction list", async () => {
      const res = await request(app).get(
        `/business/${businessId}/transactions`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((tx: any) => tx.id === "test-tx-id");
      expect(found).toBeDefined();
    });

    it("Step 4: When a container is reported as damaged and replaced", async () => {
      const res = await request(app)
        .post(`/business/${businessId}/transactions`)
        .send({
          type: "collection",
          customerId,
          collectionItems: [
            {
              inventoryId: "item-123",
              name: "Round Container",
              qtyExpected: 1,
              qtyOk: 0, // 0 because it is damaged and not usable
              status: "damaged",
              replacedFromInventory: true,
            },
          ],
          totalAmount: 0,
          amountPaid: 0,
          paymentStatus: "paid",
          deliveryStatus: "completed",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.collectionItems[0].status).toBe("damaged");
      expect(res.body.data.collectionItems[0].qtyOk).toBe(0);
      expect(res.body.data.collectionItems[0].qtyCollected).toBe(0);
    });
  });
});
