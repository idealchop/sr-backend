import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";
import { DEFAULT_GEMINI_MODEL } from "../../services/ai/gemini-config";

const geminiGenerateJson = vi.fn();

const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: "ai-run-bdd-1" }),
    collection: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };
  return { mockCollection: mc };
});

vi.mock("../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
  auth: {
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "user123", email: "test@test.com" }),
  },
}));

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com" };
    next();
  }),
}));

vi.mock("../../middleware/business-middleware", () => ({
  validateBusinessAccess: vi.fn((_req: any, _res: any, next: any) => next()),
  requireBusinessOwner: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/ai/gemini-client", () => ({
  geminiGenerateJson: (...args: unknown[]) => geminiGenerateJson(...args),
}));

vi.mock("../../services/ai/gemini-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/ai/gemini-config")>();
  return {
    ...actual,
    getGeminiApiKey: vi.fn(() => ""),
    getGeminiModel: vi.fn(() => DEFAULT_GEMINI_MODEL),
  };
});

vi.mock("../../services/transactions/transaction-service", () => ({
  TransactionService: {
    getTransactionsByBusiness: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomersByBusiness: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/inventory/inventory-service", () => ({
  InventoryService: {
    listItems: vi.fn().mockResolvedValue([]),
  },
}));

describe("Feature: River AI tool runs", () => {
  const businessId = "test-biz-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        data: () => ({ name: "BDD Station" }),
      }),
      collection: vi.fn(() => mockCollection),
    });
    mockCollection.orderBy.mockReturnThis();
    mockCollection.limit.mockReturnThis();
    mockCollection.get.mockResolvedValue({ docs: [] });
    mockCollection.collection.mockReturnValue(mockCollection);
    geminiGenerateJson.mockImplementation(async ({ fallback }) => fallback);
  });

  describe("Scenario: Owner runs morning brief without Gemini configured", () => {
    it("Step 1: Given an authenticated owner workspace", () => {
      expect(businessId).toBeDefined();
    });

    it("Step 2: When POST morning_brief is requested", async () => {
      const res = await request(app)
        .post(`/business/${businessId}/ai-tools/runs`)
        .send({ tool: "morning_brief" });

      expect(res.status).toBe(201);
      expect(res.body.data.tool).toBe("morning_brief");
      expect(res.body.data.summary).toContain("not configured");
      expect(res.body.data.aiModel).toBe(DEFAULT_GEMINI_MODEL);
      expect(res.body.data.dataSnapshot.businessName).toBe("BDD Station");
    });

    it("Step 3: Then invalid tool ids are rejected", async () => {
      const res = await request(app)
        .post(`/business/${businessId}/ai-tools/runs`)
        .send({ tool: "not_a_tool" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Unknown tool|tool/i);
    });

    it("Step 4: And prior runs can be listed", async () => {
      mockCollection.get.mockResolvedValueOnce({
        docs: [
          {
            id: "run-1",
            data: () => ({
              tool: "morning_brief",
              toolLabel: "Owner morning brief",
              title: "Station insight",
              summary: "Saved snapshot",
              highlights: [],
              actionItems: [],
              riskLevel: "low",
              dataSnapshot: {},
              createdAt: { toDate: () => new Date("2026-06-01T08:00:00Z") },
              createdByUid: "user123",
              aiModel: DEFAULT_GEMINI_MODEL,
            }),
          },
        ],
      });

      const res = await request(app).get(
        `/business/${businessId}/ai-tools/runs`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].aiModel).toBe(DEFAULT_GEMINI_MODEL);
    });
  });
});
