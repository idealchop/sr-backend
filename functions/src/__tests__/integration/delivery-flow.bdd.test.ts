import { describe, it, expect, vi } from "vitest";
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

  mc.doc.mockImplementation((id?: string) => {
    if (id === "test-delivery-id") {
      return createDocMock("test-delivery-id", { status: "pending" });
    }
    return createDocMock(id || "test-id", { ownerId: "user123" });
  });

  mc.where.mockReturnThis();
  mc.get.mockResolvedValue({
    docs: [{ id: "test-delivery-id", data: () => ({ status: "pending" }) }],
  });

  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/notifications/notification-service", () => ({
  NotificationService: {
    broadcastToBusiness: vi.fn().mockResolvedValue({}),
    send: vi.fn().mockResolvedValue({}),
  },
}));

// This test simulates a BDD flow for Delivery Management
describe("Feature: Delivery Management Flow", () => {
  const businessId = "test-biz-123";
  const customerId = "cust-456";
  const transactionId = "tx-789";
  let deliveryId = "";
  const riderId = "rider-001";

  describe("Scenario: Successfully scheduling and assigning a delivery", () => {
    it("Step 1: Given a transaction exists for a customer", async () => {
      expect(customerId).toBeDefined();
      expect(transactionId).toBeDefined();
    });

    it("Step 2: When the manager creates a delivery for this transaction", async () => {
      const res = await request(app)
        .post(`/business/${businessId}/deliveries`)
        .send({
          customerId,
          transactionId,
          items: [{ waterTypeId: "slim", quantity: 2 }],
          location: { address: "123 Street", lat: 14.5, lng: 121.0 },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      deliveryId = res.body.id;
      expect(res.body.status).toBe("pending");
    });

    it("Step 4: When the manager assigns a rider to the delivery", async () => {
      const res = await request(app)
        .post(`/business/${businessId}/deliveries/${deliveryId}/assign`)
        .send({ riderId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("Step 5: Then the manager can list active deliveries", async () => {
      const res = await request(app).get(
        `/business/${businessId}/deliveries/active`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("Step 6: When the rider completes the delivery with a signature", async () => {
      const signatureUrl = "https://storage.google.com/signatures/test-bdd.png";
      const res = await request(app)
        .post(`/business/${businessId}/deliveries/test-delivery-id/complete`)
        .send({
          containerMovements: [],
          signatureUrl,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verification of DB updates is handled in unit tests,
      // but here we verify the API response.
    });
  });
});
