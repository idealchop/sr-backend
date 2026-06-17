import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockGet } = vi.hoisted(() => {
  const update = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn();
  return { mockUpdate: update, mockGet: get };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: mockGet,
            update: mockUpdate,
          })),
        })),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-ts"),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

import {
  CustomerLastFulfilledService,
  resolveFulfilledActivity,
} from "../../../../services/customers/customer-last-fulfilled-service";

describe("resolveFulfilledActivity", () => {
  it("returns activity for fulfilled delivery", () => {
    const activity = resolveFulfilledActivity({
      type: "delivery",
      deliveryStatus: "delivered",
      scheduledAt: "2026-05-01T08:00:00.000Z",
      deliveredAt: "2026-05-01T10:00:00.000Z",
    });
    expect(activity?.type).toBe("delivery");
    expect(activity?.at.toISOString()).toBe("2026-05-01T10:00:00.000Z");
  });

  it("returns null for pending delivery", () => {
    expect(
      resolveFulfilledActivity({
        type: "delivery",
        deliveryStatus: "pending",
        scheduledAt: "2026-05-01T08:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("returns activity for walk-in", () => {
    const activity = resolveFulfilledActivity({
      type: "walkin",
      deliveryStatus: "pending",
      createdAt: "2026-05-02T08:00:00.000Z",
    });
    expect(activity?.type).toBe("walkin");
  });
});

describe("CustomerLastFulfilledService.touchFromTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes lastFulfilledAt when customer has no prior anchor", async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    await CustomerLastFulfilledService.touchFromTransaction("biz-1", {
      customerId: "cust-1",
      type: "delivery",
      deliveryStatus: "delivered",
      deliveredAt: "2026-06-01T08:00:00.000Z",
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFulfilledType: "delivery",
        lastOrderAt: expect.any(Date),
        lastFulfilledAt: expect.any(Date),
      }),
    );
  });

  it("skips when existing lastFulfilledAt is newer", async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        lastFulfilledAt: new Date("2026-06-10T08:00:00.000Z"),
      }),
    });

    await CustomerLastFulfilledService.touchFromTransaction("biz-1", {
      customerId: "cust-1",
      type: "delivery",
      deliveryStatus: "delivered",
      deliveredAt: "2026-06-01T08:00:00.000Z",
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("CustomerLastFulfilledService.backfillBusiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("patches customers with latest fulfilled activity from ledger", async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    const result = await CustomerLastFulfilledService.backfillBusiness(
      "biz-1",
      [
        {
          customerId: "cust-1",
          type: "delivery",
          deliveryStatus: "delivered",
          deliveredAt: "2026-06-01T08:00:00.000Z",
        },
        {
          customerId: "cust-1",
          type: "delivery",
          deliveryStatus: "delivered",
          deliveredAt: "2026-06-10T08:00:00.000Z",
        },
      ],
    );

    expect(result.patched).toBe(1);
    expect(result.scannedCustomers).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFulfilledType: "delivery",
        lastFulfilledAt: new Date("2026-06-10T08:00:00.000Z"),
      }),
    );
  });

  it("skips customers that already have lastFulfilledAt when onlyMissing", async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        lastFulfilledAt: new Date("2026-06-05T08:00:00.000Z"),
      }),
    });

    const result = await CustomerLastFulfilledService.backfillBusiness(
      "biz-1",
      [
        {
          customerId: "cust-1",
          type: "delivery",
          deliveryStatus: "delivered",
          deliveredAt: "2026-06-10T08:00:00.000Z",
        },
      ],
      { onlyMissing: true },
    );

    expect(result.patched).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
