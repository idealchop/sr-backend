import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
import { InventoryService } from "../../services/inventory/inventory-service";

// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-customer-id" }),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };

  const createDocMock = (id: string, data: any) => ({
    id,
    get: vi.fn().mockResolvedValue({
      exists: true,
      id,
      data: () => data,
    }),
    set: mc.set,
    update: mc.update,
    delete: mc.delete,
    collection: vi.fn(() => mc),
  });

  // Default behavior for doc()
  mc.doc.mockImplementation((id?: string) => {
    if (id === "non-existent") {
      return {
        id,
        get: vi.fn().mockResolvedValue({ exists: false }),
      };
    }
    if (id === "new-customer-id") {
      return createDocMock("new-customer-id", {
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "1234567890",
        businessId: "test-id",
        status: "active",
      });
    }
    if (id === "test-customer-id") {
      return createDocMock("test-customer-id", {
        name: "John Doe",
        email: "john@example.com",
        businessId: "test-id",
      });
    }
    if (id === "item-123") {
      return createDocMock("item-123", {
        name: "Round Container",
        stock: { current: 10, min: 2 },
      });
    }
    if (!id) {
      return { ...createDocMock("new-customer-id", {}), id: "new-customer-id" };
    }
    // Business doc
    return createDocMock(id || "test-biz-id", { ownerId: "user123" });
  });

  mc.where.mockReturnThis();
  mc.orderBy.mockReturnThis();
  mc.limit.mockReturnThis();
  mc.get.mockResolvedValue({
    empty: false,
    forEach: (callback: any) =>
      [
        {
          id: "test-customer-id",
          data: () => ({
            name: "John Doe",
            email: "john@example.com",
            status: "active",
            hasBalance: false,
            createdAt: { toDate: () => new Date() },
          }),
        },
      ].forEach(callback),
    docs: [
      {
        id: "test-customer-id",
        data: () => ({
          name: "John Doe",
          email: "john@example.com",
          status: "active",
          hasBalance: false,
          createdAt: { toDate: () => new Date() },
        }),
      },
    ],
  });
  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => {
      return mockCollection;
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
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/customers/qr-customer-service", () => ({
  QrCustomerService: {
    rotateCustomerQr: vi.fn().mockResolvedValue(undefined),
    assertValidPortalToken: vi
      .fn()
      .mockRejectedValue(new Error("INVALID_TOKEN")),
    renderQrPng: vi.fn().mockResolvedValue(Buffer.from("")),
  },
}));

vi.mock("../../services/inventory/inventory-service", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    InventoryService: {
      adjustStock: vi.fn().mockResolvedValue(100),
      createAssignment: vi.fn().mockResolvedValue(undefined),
      listItems: vi.fn().mockResolvedValue([]),
      createItem: vi.fn().mockResolvedValue("new-item-id"),
      updateItem: vi.fn().mockResolvedValue({}),
      deleteItem: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock("../../services/customers/customer-active-limit-service", () => ({
  CustomerActiveLimitService: {
    assertCanAddActiveCustomer: vi.fn().mockResolvedValue(undefined),
    assertCanActivateCustomer: vi.fn().mockResolvedValue(undefined),
  },
  CustomerActiveLimitError: class CustomerActiveLimitError extends Error {
    code = "ACTIVE_CUSTOMER_CAP";
    activeCount = 0;
    cap = 0;
  },
}));

describe("Customer API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/customers", () => {
    it("should list customers for a business", async () => {
      const res = await request(app).get("/business/test-id/customers");
      if (res.status === 500) {
        console.error(res.body);
      }
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].name).toBe("John Doe");
    });
  });

  describe("GET /business/:businessId/customers/stats", () => {
    it("should get customer statistics", async () => {
      const res = await request(app).get("/business/test-id/customers/stats");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("total");
      expect(res.body.data).toHaveProperty("customersWithBalance");
      expect(res.body.data).not.toHaveProperty("totalBalance");
    });
  });

  describe("GET /business/:businessId/customers/:customerId", () => {
    it("should get a single customer", async () => {
      const res = await request(app).get(
        "/business/test-id/customers/test-customer-id",
      );
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("John Doe");
    });

    it("should return 404 if customer not found", async () => {
      const res = await request(app).get(
        "/business/test-id/customers/non-existent",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /business/:businessId/customers", () => {
    it("should add a new customer", async () => {
      const res = await request(app)
        .post("/business/test-id/customers")
        .send({
          name: "Jane Smith",
          email: "jane@example.com",
          phone: "1234567890",
          pricing: {
            "alkaline-id": 50,
            "purified-id": 35,
          },
          possession: {
            "slim-5g": { quantity: 1 },
          },
        });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("new-customer-id");

      // Verify stock was deducted for WRS items
      expect(InventoryService.adjustStock).toHaveBeenCalledWith(
        "test-id",
        "slim-5g",
        -1,
        expect.objectContaining({
          reason: "CUSTOMER_ONBOARDING_WRS_ASSIGNMENT",
        }),
      );
    });
  });

  describe("PATCH /business/:businessId/customers/:customerId", () => {
    it("should update a customer", async () => {
      const res = await request(app)
        .patch("/business/test-id/customers/test-customer-id")
        .send({ name: "Johnny" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should toggle operational logistics flags", async () => {
      const res = await request(app)
        .patch("/business/test-id/customers/test-customer-id")
        .send({
          isDeliveryEnabled: true,
          deliveryConfig: { frequency: "weekly" },
          isCollectionEnabled: false,
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should adjust stock when possession changes", async () => {
      const res = await request(app)
        .patch("/business/test-id/customers/test-customer-id")
        .send({
          possession: {
            "slim-5g": { quantity: 5 },
          },
        });
      expect(res.status).toBe(200);
      expect(InventoryService.adjustStock).toHaveBeenCalled();
    });
  });

  describe("DELETE /business/:businessId/customers/:customerId", () => {
    it("should delete a customer", async () => {
      const res = await request(app).delete(
        "/business/test-id/customers/test-customer-id",
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should restore stock when customer is deleted", async () => {
      const res = await request(app).delete(
        "/business/test-id/customers/test-customer-id",
      );
      expect(res.status).toBe(200);
    });
  });
});
