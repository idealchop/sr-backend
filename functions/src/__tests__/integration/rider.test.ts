import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "new-rider-id" }),
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
    if (id === "non-existent") {
      return { id, get: vi.fn().mockResolvedValue({ exists: false }) };
    }
    if (id === "test-rider-id") {
      return createDocMock("test-rider-id", {
        name: "Rider One",
        status: "active",
        userId: "user123",
      });
    }
    if (id === "other-rider-id") {
      return createDocMock("other-rider-id", {
        name: "Other Rider",
        status: "active",
        userId: "other-user",
      });
    }
    return createDocMock(id || "test-id", { ownerId: "user123" });
  });

  mc.where.mockReturnThis();
  mc.get.mockResolvedValue({
    docs: [
      {
        id: "test-rider-id",
        data: () => ({ name: "Rider One", status: "active" }),
      },
    ],
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

vi.mock("../../middleware/business-middleware", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validateBusinessAccess: vi.fn((req: any, _res: any, next: any) => {
      req.businessRole = "member";
      next();
    }),
  };
});

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/notifications/notification-service", () => ({
  NotificationService: {
    broadcastToBusiness: vi.fn().mockResolvedValue({}),
    send: vi.fn().mockResolvedValue({}),
  },
}));

describe("Rider API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/riders", () => {
    it("should list riders for a business", async () => {
      const res = await request(app).get("/business/test-biz/riders");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].name).toBe("Rider One");
    });
  });

  describe("POST /business/:businessId/riders", () => {
    it("should create a new rider", async () => {
      const res = await request(app)
        .post("/business/test-biz/riders")
        .send({ name: "New Rider", phone: "09123456789" });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("new-rider-id");
    });
  });

  describe("PATCH /business/:businessId/riders/:id", () => {
    it("should update a rider", async () => {
      const res = await request(app)
        .patch("/business/test-biz/riders/test-rider-id")
        .send({ status: "inactive" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("DELETE /business/:businessId/riders/:id", () => {
    it("should delete a rider", async () => {
      const res = await request(app).delete(
        "/business/test-biz/riders/test-rider-id",
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /business/:businessId/riders/:id/location", () => {
    it("should persist GPS for the linked rider", async () => {
      const res = await request(app)
        .post("/business/test-biz/riders/test-rider-id/location")
        .send({ latitude: 14.4081, longitude: 121.0415, accuracy: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.lastLocation).toMatchObject({
        latitude: 14.4081,
        longitude: 121.0415,
      });
      expect(mockCollection.set).toHaveBeenCalled();
    });

    it("should reject invalid coordinates", async () => {
      const res = await request(app)
        .post("/business/test-biz/riders/test-rider-id/location")
        .send({ latitude: "bad", longitude: 121 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid coordinates/i);
    });

    it("should return 403 when actor is not the linked rider", async () => {
      const res = await request(app)
        .post("/business/test-biz/riders/other-rider-id/location")
        .send({ latitude: 14.4, longitude: 121.0 });

      expect(res.status).toBe(403);
    });

    it("should return 404 for unknown rider", async () => {
      const res = await request(app)
        .post("/business/test-biz/riders/non-existent/location")
        .send({ latitude: 14.4, longitude: 121.0 });

      expect(res.status).toBe(404);
    });
  });
});
