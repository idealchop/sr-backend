import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  businessGet: vi.fn(),
  featureGet: vi.fn(),
  where: vi.fn(),
  ratingsGet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "businesses") {
        return {
          doc: vi.fn(() => ({
            get: mocks.businessGet,
          })),
        };
      }
      if (name === "platform_features") {
        return {
          doc: vi.fn(() => ({
            get: mocks.featureGet,
          })),
        };
      }
      if (name === "feature_ratings") {
        const chain = {
          where: mocks.where,
          limit: vi.fn(() => chain),
          get: mocks.ratingsGet,
          add: mocks.add,
        };
        mocks.where.mockReturnValue(chain);
        return chain;
      }
      return { add: vi.fn(), where: vi.fn() };
    }),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
}));

import {
  FeatureRatingsService,
  normalizeFeatureRatingsAppId,
} from "../../../../services/platform/feature-ratings-service";
import { INVENTORY_CONTAINER_REVAMP_FEATURE_ID } from "../../../../services/platform/feature-ratings-types";

describe("normalizeFeatureRatingsAppId", () => {
  it("maps smartrefill-v3 to smartrefill", () => {
    expect(normalizeFeatureRatingsAppId("smartrefill-v3")).toBe("smartrefill");
    expect(normalizeFeatureRatingsAppId("smartrefill")).toBe("smartrefill");
  });
});

describe("FeatureRatingsService.submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: "Aqua Station",
        phone: "+639171234567",
        ownerId: "owner-1",
      }),
    });
    mocks.featureGet.mockResolvedValue({ exists: false });
    mocks.add.mockImplementation(async (doc) => ({
      id: "fr-abc",
      get: async () => ({
        data: () => ({
          ...doc,
          submittedAt: { toMillis: () => Date.now() },
          createdAt: { toMillis: () => Date.now() },
        }),
      }),
    }));
  });

  it("writes feature_ratings with required category ratings", async () => {
    const record = await FeatureRatingsService.submit({
      appId: "smartrefill",
      source: "inventory-revamp-guide",
      businessId: "biz-1",
      userId: "uid-1",
      userEmail: "owner@example.com",
      displayName: "Owner Name",
      role: "owner",
      featureId: INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
      ratings: { uiLayout: 4, functionality: 5 },
      feedback: "Clear guide, arrival dialog is helpful",
    });

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "smartrefill",
        featureId: INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
        featureLifecycle: "active",
        ratings: { uiLayout: 4, functionality: 5 },
        feedback: "Clear guide, arrival dialog is helpful",
        acknowledgement: expect.objectContaining({ status: "pending" }),
      }),
    );

    expect(record.featureLifecycle).toBe("active");
    expect(record.ratings.functionality).toBe(5);
  });

  it("snapshots decommissioned lifecycle from platform_features", async () => {
    mocks.featureGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: "Container & Inventory Revamp",
        lifecycle: "decommissioned",
      }),
    });

    await FeatureRatingsService.submit({
      appId: "smartrefill",
      source: "dashboard",
      businessId: "biz-1",
      userId: "uid-1",
      featureId: INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
      ratings: { uiLayout: 3, functionality: 3 },
      feedback: "",
    });

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ featureLifecycle: "decommissioned" }),
    );
  });
});

describe("FeatureRatingsService.validateRatingsPayload", () => {
  it("rejects missing or out-of-range ratings", () => {
    expect(
      FeatureRatingsService.validateRatingsPayload({ uiLayout: 4 }),
    ).toBeNull();
    expect(
      FeatureRatingsService.validateRatingsPayload({
        uiLayout: 0,
        functionality: 5,
      }),
    ).toBeNull();
  });

  it("accepts valid ratings", () => {
    expect(
      FeatureRatingsService.validateRatingsPayload({
        uiLayout: 2,
        functionality: 5,
      }),
    ).toEqual({ uiLayout: 2, functionality: 5 });
  });
});

describe("FeatureRatingsService.getLatestForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockImplementation(() => ({
      where: mocks.where,
      limit: vi.fn().mockReturnThis(),
      get: mocks.ratingsGet,
    }));
  });

  it("filters featureId in memory after three-field query", async () => {
    mocks.ratingsGet.mockResolvedValue({
      docs: [
        {
          id: "fr-1",
          data: () => ({
            appId: "smartrefill",
            featureId: "other-feature",
            business: { businessId: "biz-1", name: "Station" },
            submittedBy: { userId: "uid-1" },
            ratings: { uiLayout: 5, functionality: 5 },
            submittedAt: { toMillis: () => 1000 },
          }),
        },
        {
          id: "fr-2",
          data: () => ({
            appId: "smartrefill",
            featureId: INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
            business: { businessId: "biz-1", name: "Station" },
            submittedBy: { userId: "uid-1" },
            ratings: { uiLayout: 4, functionality: 5 },
            submittedAt: { toMillis: () => 2000 },
          }),
        },
      ],
    });

    const record = await FeatureRatingsService.getLatestForUser(
      "biz-1",
      "uid-1",
      INVENTORY_CONTAINER_REVAMP_FEATURE_ID,
    );

    expect(mocks.where).toHaveBeenCalledWith("appId", "==", "smartrefill");
    expect(record?.id).toBe("fr-2");
    expect(record?.ratings.functionality).toBe(5);
  });
});
