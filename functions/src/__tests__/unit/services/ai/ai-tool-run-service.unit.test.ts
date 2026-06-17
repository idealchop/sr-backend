import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_MODEL } from "../../../../services/ai/gemini-config";

const geminiGenerateJson = vi.fn();
const getTransactionsByBusiness = vi.fn();
const getCustomersByBusiness = vi.fn();
const listItems = vi.fn();

const { mockCollection, mockAdd } = vi.hoisted(() => {
  const add = vi.fn().mockResolvedValue({ id: "run-123" });
  const mc = {
    doc: vi.fn(),
    add,
    collection: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };
  return { mockCollection: mc, mockAdd: add };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../../services/ai/gemini-client", () => ({
  geminiGenerateJson: (...args: unknown[]) => geminiGenerateJson(...args),
}));

vi.mock("../../../../services/ai/gemini-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../services/ai/gemini-config")>();
  return {
    ...actual,
    getGeminiApiKey: vi.fn(() => ""),
    getGeminiModel: vi.fn(() => DEFAULT_GEMINI_MODEL),
  };
});

vi.mock("../../../../services/transactions/transaction-service", () => ({
  TransactionService: {
    getTransactionsByBusiness: (...args: unknown[]) =>
      getTransactionsByBusiness(...args),
  },
}));

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomersByBusiness: (...args: unknown[]) =>
      getCustomersByBusiness(...args),
  },
}));

vi.mock("../../../../services/inventory/inventory-service", () => ({
  InventoryService: {
    listItems: (...args: unknown[]) => listItems(...args),
  },
}));

import { AiToolRunService } from "../../../../services/ai/ai-tool-run-service";

describe("AiToolRunService", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        data: () => ({ name: "Test Station" }),
      }),
      collection: vi.fn(() => mockCollection),
    });
    mockCollection.orderBy.mockReturnThis();
    mockCollection.limit.mockReturnThis();
    mockCollection.get.mockResolvedValue({ docs: [] });
    mockCollection.collection.mockReturnValue(mockCollection);

    getTransactionsByBusiness.mockResolvedValue([]);
    getCustomersByBusiness.mockResolvedValue([]);
    listItems.mockResolvedValue([]);

    geminiGenerateJson.mockImplementation(async ({ fallback }) => fallback);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("rejects unknown tool ids", async () => {
    await expect(
      AiToolRunService.executeTool({
        businessId: "biz-1",
        uid: "owner-1",
        tool: "unknown_tool",
      }),
    ).rejects.toThrow("INVALID_TOOL");
  });

  it("persists a fallback run when Gemini is not configured", async () => {
    const run = await AiToolRunService.executeTool({
      businessId: "biz-1",
      uid: "owner-1",
      tool: "morning_brief",
    });

    expect(run.tool).toBe("morning_brief");
    expect(run.toolLabel).toBe("Owner morning brief");
    expect(run.summary).toContain("not configured");
    expect(run.aiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "morning_brief",
        aiModel: DEFAULT_GEMINI_MODEL,
        dataSnapshot: expect.objectContaining({ businessName: "Test Station" }),
      }),
    );
  });

  it("includes owner usageGoals in snapshot and Gemini system prompt", async () => {
    mockCollection.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        data: () => ({
          name: "Suki Station",
          usageGoals: ["sales", "delivery"],
        }),
      }),
      collection: vi.fn(() => mockCollection),
    });

    await AiToolRunService.executeTool({
      businessId: "biz-1",
      uid: "owner-1",
      tool: "dispatch_health",
    });

    const addPayload = mockAdd.mock.calls[0]?.[0] as {
      dataSnapshot: Record<string, unknown>;
    };
    const ownerUsageGoals = addPayload.dataSnapshot.ownerUsageGoals as {
      ids: string[];
      recommendedIntelTools: string[];
    };

    expect(ownerUsageGoals.ids).toEqual(["sales", "delivery"]);
    expect(ownerUsageGoals.recommendedIntelTools[0]).toBe("morning_brief");

    const geminiCall = geminiGenerateJson.mock.calls[0]?.[0] as {
      system: string;
    };
    expect(geminiCall.system).toContain("workspace priorities");
    expect(geminiCall.system).toContain("Sales tracking");
    expect(geminiCall.system).toContain("openDeliveryCount");
  });
});
