import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCustomerGet, mockCustomerUpdate, mockTxGet } = vi.hoisted(() => ({
  mockCustomerGet: vi.fn(),
  mockCustomerUpdate: vi.fn().mockResolvedValue(undefined),
  mockTxGet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn((name: string) => {
          if (name === "transactions") {
            return {
              where: vi.fn(() => ({
                limit: vi.fn(() => ({
                  get: mockTxGet,
                })),
              })),
            };
          }
          return {
            doc: vi.fn(() => ({
              get: mockCustomerGet,
              update: mockCustomerUpdate,
            })),
          };
        }),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-ts"),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { CustomerHealthScoreService } from
  "../../../../services/customers/customer-health-score-service";

describe("CustomerHealthScoreService.recompute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes healthScore from customer ledger snapshot", async () => {
    mockCustomerGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: "Ana",
        status: "active",
        lastFulfilledAt: new Date("2026-07-01T08:00:00.000Z"),
      }),
    });
    mockTxGet.mockResolvedValue({
      docs: [
        {
          id: "tx-1",
          data: () => ({
            customerId: "cust-1",
            type: "delivery",
            deliveryStatus: "delivered",
            deliveredAt: "2026-07-01T08:00:00.000Z",
            paymentStatus: "paid",
            balanceDue: 0,
            serviceRating: 5,
          }),
        },
      ],
    });

    const score = await CustomerHealthScoreService.recompute("biz-1", "cust-1");

    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(mockCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        healthScore: score,
        healthScoreUpdatedAt: "mock-ts",
      }),
    );
  });

  it("returns null when customer is missing", async () => {
    mockCustomerGet.mockResolvedValue({ exists: false });
    const score = await CustomerHealthScoreService.recompute("biz-1", "missing");
    expect(score).toBeNull();
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });
});
