import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

// --- Mocks ---
const { mockCollection, createDocMock } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-shared-route-id" }),
    get: vi.fn(),
  };

  const createDocMock = (id: string, data: any) => {
    const docRef = {
      id,
      get: vi.fn(),
    };
    (docRef.get as any).mockResolvedValue({
      exists: !!data,
      id,
      data: () => data,
    });
    return docRef;
  };

  mc.doc.mockImplementation((id?: string) => {
    if (id === "test-shared-route-id") {
      return createDocMock("test-shared-route-id", {
        businessId: "test-biz",
        riderId: "rider-1",
        riderName: "Rider One",
        businessProfile: { businessName: "Test Biz", stationAddress: "Station" },
        deliveries: [
          {
            id: "tx-stop-1",
            name: "Customer A",
            address: "Addr",
            status: "pending",
          },
        ],
        sharedAt: "mock-timestamp",
      });
    }
    if (id === "tx-stop-1") {
      return createDocMock("tx-stop-1", {
        deliveryStatus: "in-transit",
        arrivedAt: { toDate: () => new Date("2024-06-01T09:00:00Z") },
        deliveredAt: null,
      });
    }
    return createDocMock(id || "test-id", null);
  });

  return { mockCollection: mc, createDocMock };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "businesses") {
        return {
          doc: vi.fn(() => ({
            collection: vi.fn((sub: string) => {
              if (sub === "transactions") {
                return {
                  doc: vi.fn((txId: string) => {
                    if (txId === "tx-stop-1") {
                      return createDocMock("tx-stop-1", {
                        deliveryStatus: "in-transit",
                        arrivedAt: {
                          toDate: () => new Date("2024-06-01T09:00:00Z"),
                        },
                      });
                    }
                    return createDocMock(txId, null);
                  }),
                };
              }
              return mockCollection;
            }),
          })),
        };
      }
      return mockCollection;
    }),
  },
  auth: {
    verifyIdToken: vi.fn().mockResolvedValue({
      uid: "user123",
      email: "test@test.com",
    }),
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

vi.mock("../../middleware/business-middleware", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validateBusinessAccess: vi.fn((req: any, res: any, next: any) => {
      next();
    }),
    requireBusinessOwner: vi.fn((req: any, res: any, next: any) => {
      next();
    }),
  };
});

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/riders/rider-tracking-service", () => ({
  RiderTrackingService: {
    getRiderLastLocation: vi.fn().mockResolvedValue({
      latitude: 14.55,
      longitude: 121.15,
      updatedAt: { toDate: () => new Date("2024-06-01T10:30:00Z") },
    }),
  },
}));

describe("Shared Route API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /business/:businessId/deliveries/share", () => {
    it("should create a shared route record", async () => {
      const payload = {
        businessProfile: { businessName: "Test Biz" },
        deliveries: [{ id: "d1", name: "Cust 1", address: "Addr 1" }],
      };
      const res = await request(app)
        .post("/business/test-biz/deliveries/share")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("new-shared-route-id");
      expect(mockCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: "test-biz",
          ownerId: "user123",
        }),
      );
    });
  });

  describe("GET /public/shared-route/:id", () => {
    it("should fetch a shared route by ID", async () => {
      const res = await request(app).get(
        "/public/shared-route/test-shared-route-id",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.businessProfile.businessName).toBe("Test Biz");
    });

    it("should enrich shared route with rider GPS and stop timestamps", async () => {
      const res = await request(app).get(
        "/public/shared-route/test-shared-route-id",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.riderLocation).toMatchObject({
        latitude: 14.55,
        longitude: 121.15,
      });
      expect(res.body.data.deliveries[0].status).toBe("in-transit");
      expect(res.body.data.deliveries[0].arrivedAt).toBeTruthy();
    });

    it("should return 404 if route not found", async () => {
      const res = await request(app).get(
        "/public/shared-route/non-existent-id",
      );
      expect(res.status).toBe(404);
    });
  });
});
