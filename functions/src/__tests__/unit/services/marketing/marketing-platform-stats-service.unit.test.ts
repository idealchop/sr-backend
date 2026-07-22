import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  statsGet: vi.fn(),
  statsSet: vi.fn(),
  businessesSelectGet: vi.fn(),
  customersCountGet: vi.fn(),
  transactionsCountGet: vi.fn(),
  transactionsPageGet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    doc: vi.fn((path: string) => {
      if (path === "platform/marketing_stats") {
        return {
          get: mocks.statsGet,
          set: mocks.statsSet,
        };
      }
      return { get: vi.fn(), set: vi.fn() };
    }),
    collection: vi.fn((name: string) => {
      if (name === "businesses") {
        return {
          select: () => ({
            get: mocks.businessesSelectGet,
          }),
        };
      }
      return { select: () => ({ get: vi.fn() }) };
    }),
    collectionGroup: vi.fn((name: string) => {
      if (name === "customers") {
        return {
          count: () => ({ get: mocks.customersCountGet }),
        };
      }
      if (name === "transactions") {
        const pageChain: {
          select: () => typeof pageChain;
          limit: () => typeof pageChain;
          startAfter: () => typeof pageChain;
          count: () => { get: typeof mocks.transactionsCountGet };
          get: typeof mocks.transactionsPageGet;
        } = {
          select: () => pageChain,
          limit: () => pageChain,
          startAfter: () => pageChain,
          count: () => ({ get: mocks.transactionsCountGet }),
          get: mocks.transactionsPageGet,
        };
        return pageChain;
      }
      return { count: () => ({ get: vi.fn() }) };
    }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
    delete: vi.fn(() => "DELETE"),
  },
}));

import {
  gallonsFromVolumeSalesTx,
  getMarketingPlatformStats,
  isVolumeSalesTransaction,
} from "../../../../services/marketing/marketing-platform-stats-service";

describe("volume sales helpers", () => {
  it("includes fulfilled delivery / walk-in / direct sale only", () => {
    expect(
      isVolumeSalesTransaction({
        type: "delivery",
        deliveryStatus: "delivered",
      }),
    ).toBe(true);
    expect(
      isVolumeSalesTransaction({
        type: "delivery",
        deliveryStatus: "pending",
      }),
    ).toBe(false);
    expect(isVolumeSalesTransaction({ type: "walkin" })).toBe(true);
    expect(isVolumeSalesTransaction({ type: "direct_sale" })).toBe(true);
    expect(isVolumeSalesTransaction({ type: "expense" })).toBe(false);
    expect(isVolumeSalesTransaction({ type: "collection" })).toBe(false);
  });

  it("sums waterRefills gallons", () => {
    expect(
      gallonsFromVolumeSalesTx({
        type: "walkin",
        waterRefills: [{ quantity: 5 }, { quantity: 2 }],
      }),
    ).toBe(7);
  });
});

describe("getMarketingPlatformStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statsSet.mockResolvedValue(undefined);
    mocks.businessesSelectGet.mockResolvedValue({
      docs: [
        { data: () => ({ ownerId: "owner-a" }) },
        { data: () => ({ ownerId: "owner-a" }) },
        { data: () => ({ ownerId: "owner-b" }) },
      ],
    });
    mocks.customersCountGet.mockResolvedValue({ data: () => ({ count: 1096 }) });
    mocks.transactionsCountGet.mockResolvedValue({
      data: () => ({ count: 5098 }),
    });
    mocks.transactionsPageGet.mockResolvedValue({
      empty: false,
      size: 3,
      docs: [
        {
          data: () => ({
            type: "delivery",
            deliveryStatus: "delivered",
            waterRefills: [{ quantity: 10 }],
          }),
        },
        {
          data: () => ({
            type: "walkin",
            waterRefills: [{ quantity: 5 }],
          }),
        },
        {
          data: () => ({
            type: "expense",
            waterRefills: [{ quantity: 99 }],
          }),
        },
      ],
    });
  });

  it("returns cached stats when fresh", async () => {
    const updatedAt = { toDate: () => new Date() };
    mocks.statsGet.mockResolvedValue({
      exists: true,
      data: () => ({
        metricVersion: 4,
        litersDelivered: 9000,
        transactionsProcessed: 5000,
        wrsOperators: 400,
        customersServed: 1000,
        updatedAt,
        previous: {
          litersDelivered: 8900,
          transactionsProcessed: 4980,
          wrsOperators: 399,
          customersServed: 995,
          updatedAtMs: Date.now() - 60 * 60 * 1000,
        },
      }),
    });

    const stats = await getMarketingPlatformStats();
    expect(stats.litersDelivered).toBe(9000);
    expect(stats.wrsOperators).toBe(400);
    expect(mocks.businessesSelectGet).not.toHaveBeenCalled();
  });

  it("recomputes liters from delivery/walkin/direct_sale refill volume", async () => {
    mocks.statsGet.mockResolvedValue({ exists: false, data: () => undefined });

    const stats = await getMarketingPlatformStats();
    expect(stats.wrsOperators).toBe(2);
    expect(stats.customersServed).toBe(1096);
    expect(stats.transactionsProcessed).toBe(5098);
    // 10 + 5 gallons → liters
    expect(stats.litersDelivered).toBe(Math.round(15 * 3.78541));
    expect(mocks.statsSet).toHaveBeenCalled();
  });
});
