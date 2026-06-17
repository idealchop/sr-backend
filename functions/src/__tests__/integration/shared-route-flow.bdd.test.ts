import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com", name: "Test User" };
    next();
  }),
}));

vi.mock("../../middleware/business-middleware", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validateBusinessAccess: vi.fn((req: any, res: any, next: any) => next()),
    requireBusinessOwner: vi.fn((req: any, res: any, next: any) => next()),
  };
});

const mockDbAdd = vi.fn().mockResolvedValue({ id: "shared-route-id-123" });
const mockDbGet = vi.fn();

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      add: mockDbAdd,
      doc: vi.fn(() => ({
        get: mockDbGet,
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

describe("Feature: Shared Route Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario: User shares a route and a customer views it", () => {
    it("Step 1: Given a business owner wants to share a list of deliveries", async () => {
      // Setup payload
      const payload = {
        businessProfile: { businessName: "Test Water Station" },
        deliveries: [
          { id: "del-1", name: "Customer 1", address: "123 Main St" },
          { id: "del-2", name: "Customer 2", address: "456 Elm St" },
        ],
      };

      // Step 2: When the owner generates a shared route link
      const res = await request(app)
        .post("/business/test-biz/deliveries/share")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("shared-route-id-123");

      expect(mockDbAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          ownerId: "user123",
          deliveries: payload.deliveries,
        }),
      );
    });

    it("Step 3: And a customer opens the shared route link", async () => {
      mockDbGet.mockResolvedValueOnce({
        exists: true,
        id: "shared-route-id-123",
        data: () => ({
          businessProfile: { businessName: "Test Water Station" },
          deliveries: [
            { id: "del-1", name: "Customer 1", address: "123 Main St" },
            { id: "del-2", name: "Customer 2", address: "456 Elm St" },
          ],
          sharedAt: "mock-timestamp",
        }),
      });

      const res = await request(app).get(
        "/public/shared-route/shared-route-id-123",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.businessProfile.businessName).toBe(
        "Test Water Station",
      );
      expect(res.body.data.deliveries.length).toBe(2);
    });

    it("Step 4: Or the customer opens an invalid shared route link", async () => {
      mockDbGet.mockResolvedValueOnce({
        exists: false,
      });

      const res = await request(app).get("/public/shared-route/invalid-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });
});
